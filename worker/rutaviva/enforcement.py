"""Build the full list of fixed enforcement equipment from every source, without duplicates.

Priority: the DGT report (complete and current, but road + kilometre only) placed with the exact
coordinates of the DGT's NAP feed or of OpenStreetMap whenever they describe the same device;
then OpenStreetMap for what the DGT does not cover (Catalonia, the Basque Country, cities).
Each item says how its position was obtained (`pos`): 'exacta' or 'aproximada'.
"""
from __future__ import annotations

import math
from typing import Any, Awaitable, Callable

from .osm import road_key
from .pk import PkIndex, Router

Snap = Callable[[list[tuple[str, list[tuple[float, float]], float | None]]], Awaitable[dict[str, list[list[float]]]]]

LABEL = {'fijo': 'Radar fijo', 'tramo': 'Radar de tramo', 'semaforo': 'Cámara de semáforo en rojo',
         'cinturon': 'Cámara de cinturón y móvil', 'linea': 'Cámara de línea continua', 'stop': 'Cámara de stop'}


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 85, (a[1] - b[1]) * 111)


def _grid(items: list[dict[str, Any]]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    g: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for o in items:
        g.setdefault((int(o['lon'] * 50), int(o['lat'] * 50)), []).append(o)
    return g


def _nearest(g: dict[tuple[int, int], list[dict[str, Any]]], lon: float, lat: float, radius: float,
             skip: set[str] | None = None) -> dict[str, Any] | None:
    cx, cy = int(lon * 50), int(lat * 50)
    best, bd = None, radius
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for o in g.get((cx + dx, cy + dy), []):
                if skip and o['id'] in skip:
                    continue
                d = _km((lon, lat), (o['lon'], o['lat']))
                if d <= bd:
                    best, bd = o, d
    return best


async def build(informe: list[dict[str, Any]], equipos: list[dict[str, Any]], nap: list[dict[str, Any]],
                osm: dict[str, Any], index: PkIndex, route: Router, snap: Snap) -> tuple[list[dict], list[dict]]:
    """Returns (points, sections). Points: one per device (sections also get a point at their start)."""
    points: list[dict[str, Any]] = []
    sections: list[dict[str, Any]] = []
    nap_by_road: dict[str, list[dict[str, Any]]] = {}
    for r in nap:
        nap_by_road.setdefault(road_key(r['road']), []).append(r)
    used_nap: set[str] = set()
    osm_cams = osm.get('cameras', [])
    cam_grid = _grid(osm_cams)
    used_osm: set[str] = set()
    osm_sections = osm.get('sections', [])
    used_sections: set[str] = set()

    def nap_match(row: dict[str, Any], kind: str) -> dict[str, Any] | None:
        best, bd = None, 0.5
        for r in nap_by_road.get(road_key(row['road']), []):
            if r['id'] in used_nap or r.get('km') is None or (r['kind'] == 'tramo') != (kind == 'tramo'):
                continue
            d = abs(r['km'] - row['km'])
            if d <= bd:
                best, bd = r, d
        return best

    def osm_section(road: str, a: tuple[float, float], b: tuple[float, float] | None) -> dict[str, Any] | None:
        best, bd = None, 3.0
        for s in osm_sections:
            if s['id'] in used_sections:
                continue
            if s['road'] and road_key(s['road']) != road_key(road):
                continue
            d1 = _km(a, s['from'])
            d2 = _km(b, s['to']) if b else 0
            d = max(d1, d2)
            if d <= bd:
                best, bd = s, d
        return best

    # ---------------------------------------------------------------- DGT report: fixed and sections
    for i, row in enumerate(informe):
        if row['kind'] not in ('fijo', 'tramo'):
            continue
        base = {'id': f"dgt:{row['kind']}:{road_key(row['road'])}:{row['km']}:{row['dir']}", 'kind': row['kind'], 'src': 'dgt',
                'road': row['road'], 'km': row['km'], 'prov': row['prov'], 'dir': row['dir']}
        n = nap_match(row, row['kind'])
        if row['kind'] == 'fijo':
            if n:
                used_nap.add(n['id'])
                pt, pos = (n['lon'], n['lat']), 'exacta'
            else:
                loc = await index.locate(row['road'], row['km'], route)
                if not loc:
                    continue
                cam = _nearest(cam_grid, loc[0], loc[1], 1.5, used_osm)
                if cam:
                    used_osm.add(cam['id'])
                    pt, pos = (cam['lon'], cam['lat']), 'exacta'
                else:
                    pt, pos = (loc[0], loc[1]), 'aproximada'
            cam = _nearest(cam_grid, pt[0], pt[1], 0.2, used_osm)
            if cam:
                used_osm.add(cam['id'])
                base['maxspeed'] = cam.get('maxspeed')
            points.append({**base, 'lon': pt[0], 'lat': pt[1], 'pos': pos})
            continue
        # Average-speed section.
        km2 = row.get('km2')
        base['km2'] = km2
        base['len'] = round(row['len_m'] / 1000, 2) if row.get('len_m') else None
        a = b = None
        pos = 'aproximada'
        if n and n.get('line'):
            used_nap.add(n['id'])
            a, b = tuple(n['line'][0]), tuple(n['line'][-1])
            pos = 'exacta'
        else:
            la = await index.locate(row['road'], row['km'], route)
            lb = await index.locate(row['road'], km2, route) if km2 is not None else None
            if la:
                a = (la[0], la[1])
            if lb:
                b = (lb[0], lb[1])
        if not a:
            continue
        s = osm_section(row['road'], a, b)
        if s:
            used_sections.add(s['id'])
            base['maxspeed'] = s.get('maxspeed')
            lines = s['lines'] or [[list(s['from']), list(s['to'])]]
            sections.append({**base, 'lines': lines, 'pos': 'exacta'})
            points.append({**base, 'lon': s['from'][0], 'lat': s['from'][1], 'pos': 'exacta'})
            continue
        if b:
            snapped = await snap([(base['id'], [a, b], base['len'])])
            line = snapped.get(base['id'])
            if line:
                sections.append({**base, 'lines': [line], 'pos': pos})
        cam = _nearest(cam_grid, a[0], a[1], 0.3, used_osm)
        if cam:
            used_osm.add(cam['id'])
            base['maxspeed'] = base.get('maxspeed') or cam.get('maxspeed')
        points.append({**base, 'lon': a[0], 'lat': a[1], 'pos': pos})

    # ---------------------------------------------------------------- NAP radars missing from the report
    for r in nap:
        if r['id'] in used_nap:
            continue
        # Still published in the NAP feed: keep it, unless the report has a device of the same kind next to it.
        if any(_km((r['lon'], r['lat']), (p['lon'], p['lat'])) < 0.3 and p['kind'] == r['kind'] for p in points):
            continue
        item = {k: r.get(k) for k in ('road', 'km', 'km2', 'prov', 'dir', 'len')}
        points.append({**item, 'id': f"nap:{r['id']}", 'kind': r['kind'], 'src': 'dgt', 'lon': r['lon'], 'lat': r['lat'], 'pos': 'exacta'})
        if r.get('line'):
            sections.append({**item, 'id': f"nap:{r['id']}", 'kind': 'tramo', 'src': 'dgt', 'lines': [r['line']], 'pos': 'exacta'})

    # ---------------------------------------------------------------- DGT automatic cameras (seat belt, red light...)
    for row in equipos:
        loc = await index.locate(row['road'], row['km'], route)
        if not loc:
            continue
        points.append({'id': f"dgt:{row['kind']}:{road_key(row['road'])}:{row['km']}:{row['dir']}", 'kind': row['kind'], 'src': 'dgt',
                       'road': row['road'], 'km': row['km'], 'prov': row['prov'], 'dir': row['dir'],
                       'lon': loc[0], 'lat': loc[1], 'pos': 'exacta' if loc[2] == 'exacto' else 'aproximada'})

    # ---------------------------------------------------------------- OpenStreetMap: what the DGT lists do not have
    for s in osm_sections:
        if s['id'] in used_sections:
            continue
        if any(p['kind'] == 'tramo' and _km(s['from'], (p['lon'], p['lat'])) < 1.0 for p in points):
            continue
        item = {'id': s['id'], 'kind': 'tramo', 'src': 'osm', 'road': s['road'], 'maxspeed': s.get('maxspeed'), 'note': s.get('note', ''),
                'len': round(sum(_km(tuple(ln[i]), tuple(ln[i + 1])) for ln in s['lines'] for i in range(len(ln) - 1)), 2) if s['lines'] else None}
        sections.append({**item, 'lines': s['lines'] or [[list(s['from']), list(s['to'])]], 'pos': 'exacta'})
        points.append({**item, 'lon': s['from'][0], 'lat': s['from'][1], 'pos': 'exacta'})
    pgrid = _grid(points)
    for c in osm_cams:
        if c['id'] in used_osm or c.get('temporary'):
            continue
        if _nearest(pgrid, c['lon'], c['lat'], 0.15):
            continue
        points.append({'id': c['id'], 'kind': c['kind'], 'src': 'osm', 'lon': c['lon'], 'lat': c['lat'], 'maxspeed': c.get('maxspeed'),
                       'dir': c.get('direction', ''), 'note': c.get('note', ''), 'pos': 'exacta'})
    pgrid = _grid(points)
    for lt in osm.get('lights', []):
        if _nearest(pgrid, lt['lon'], lt['lat'], 0.1):
            continue
        points.append({'id': lt['id'], 'kind': 'semaforo', 'src': 'osm', 'lon': lt['lon'], 'lat': lt['lat'], 'pos': 'exacta'})
    for p in points:
        p['label'] = LABEL.get(p['kind'], 'Radar')
    return points, sections
