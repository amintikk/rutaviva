"""Build the full list of fixed enforcement equipment from every source, without duplicates.

Priority: the DGT report (complete and current, but road + kilometre only) placed with the exact
coordinates of the DGT's NAP feed or of OpenStreetMap whenever they describe the same device;
then the Servei Català de Trànsit's own list for Catalonia (where the DGT has no say), and finally
OpenStreetMap for what no official list covers (the Basque Country, Navarre, cities).
Each item says how its position was obtained (`pos`): 'exacta' or 'aproximada'.

The DGT report also lists the stretches where it uses mobile radars ("Radar Móvil", km X to km Y):
they become `movil_zona` zones, which say where checks happen, never where a radar is now.
"""
from __future__ import annotations

import math
from typing import Any, Awaitable, Callable

from .osm import road_key
from .pk import PkIndex, Router

Snap = Callable[[list[tuple[str, list[tuple[float, float]], float | None]]], Awaitable[dict[str, list[list[float]]]]]

LABEL = {'fijo': 'Radar fijo', 'tramo': 'Radar de tramo', 'semaforo': 'Cámara de semáforo en rojo',
         'cinturon': 'Cámara de cinturón y móvil', 'linea': 'Cámara de línea continua', 'stop': 'Cámara de stop',
         'remolque': 'Radar remolque', 'movil_zona': 'Zona de radar móvil'}


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
                osm: dict[str, Any], index: PkIndex, route: Router, snap: Snap,
                sct: list[dict[str, Any]] | None = None, city: list[dict[str, Any]] | None = None) -> tuple[list[dict], list[dict], dict[str, Any]]:
    """Returns (points, sections, extra). Points: one per device (sections also get a point at their start).
    extra['zones']: mobile-radar stretches with both ends placed (still to be drawn along the road);
    extra['rejected']: SCT lines left out or moved, with the reason; extra['zones_missing']: zones not placed."""
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

    # ---------------------------------------------------------------- Servei Català de Trànsit (Catalonia)
    rejected: list[str] = []

    async def sct_place(row: dict[str, Any]) -> tuple[tuple[float, float] | None, str]:
        """Choose among the file's coordinates (as written or with a typo undone) using the road and kilometre:
        a written position must lie within 15 km of where its PK is (the PK index itself can be a few km off), a repaired one within 2 km. Without a
        usable coordinate the PK gives an approximate position; without either the line is left out."""
        cands = row['cands']
        loc = await index.locate(row['road'], row['km'], route)
        if loc:
            best = min(cands, key=lambda c: _km((c[0], c[1]), (loc[0], loc[1])), default=None)
            if best:
                d = _km((best[0], best[1]), (loc[0], loc[1]))
                if d <= (2.0 if best[2] else 15.0):
                    return (best[0], best[1]), 'exacta'
                rejected.append(f"{row['raw']}: coordenadas a {d:.0f} km de su PK, situado por PK")
            else:
                rejected.append(f"{row['raw']}: coordenadas no válidas, situado por PK")
            return (loc[0], loc[1]), 'aproximada'
        written = [c for c in cands if not c[2]]
        if written:
            return (written[0][0], written[0][1]), 'exacta'
        rejected.append(f"{row['raw']}: coordenadas no válidas y PK no localizable, omitido")
        return None, ''

    async def add_official(base: dict[str, Any], pt: tuple[float, float], end: tuple[float, float] | None) -> None:
        """A device from a regional or city list: skipped if the same kind is already there, preferred over
        the same camera in OpenStreetMap; sections are drawn with OSM's geometry or along the road."""
        kind = base['kind']
        if any(p['kind'] == kind and _km(pt, (p['lon'], p['lat'])) < (0.03 if kind == 'remolque' else 0.15) for p in points):
            return
        if kind != 'remolque':
            cam = _nearest(cam_grid, pt[0], pt[1], 0.3, used_osm)
            if cam:
                used_osm.add(cam['id'])
                base['maxspeed'] = base.get('maxspeed') or cam.get('maxspeed')
        if kind == 'tramo':
            s = osm_section(base.get('road') or '', pt, end)
            if s:
                used_sections.add(s['id'])
                sections.append({**base, 'lines': s['lines'] or [[list(s['from']), list(s['to'])]], 'pos': 'exacta'})
            elif end:
                line = (await snap([(base['id'], [pt, end], base.get('len'))])).get(base['id'])
                if line:
                    sections.append({**base, 'lines': [line]})
        points.append({**base, 'lon': pt[0], 'lat': pt[1]})

    for row in sct or []:
        pt, pos = await sct_place(row)
        if not pt:
            continue
        kind = row['kind']
        base = {'id': f"sct:{kind}:{road_key(row['road'])}:{row['km']}" + (f"-{row['km2']}" if row.get('km2') is not None else ''),
                'kind': kind, 'src': 'sct', 'road': row['road'], 'km': row['km'], 'prov': 'Catalunya',
                'maxspeed': row.get('maxspeed'), 'note': row.get('note', ''), 'pos': pos}
        end = None
        if kind == 'tramo':
            base.update(km2=row['km2'], len=round(abs(row['km2'] - row['km']), 2), dir='positive' if row['km2'] > row['km'] else 'negative')
            lb = await index.locate(row['road'], row['km2'], route)
            end = (lb[0], lb[1]) if lb else None
        await add_official(base, pt, end)

    # City lists with their own coordinates (Madrid).
    for c in city or []:
        await add_official({k: v for k, v in c.items() if k not in ('lon', 'lat', 'end')} | {'pos': 'exacta'}, (c['lon'], c['lat']), c.get('end'))

    # ---------------------------------------------------------------- DGT mobile-radar stretches (zones, not positions)
    zones: list[dict[str, Any]] = []
    zones_missing = 0
    for row in informe:
        if row['kind'] != 'movil' or row.get('km2') is None:
            continue
        la = await index.locate(row['road'], row['km'], route)
        lb = await index.locate(row['road'], row['km2'], route)
        if not la or not lb:
            zones_missing += 1
            continue
        zones.append({'id': f"dgt:movil:{road_key(row['road'])}:{row['km']}-{row['km2']}", 'kind': 'movil_zona', 'src': 'dgt',
                      'road': row['road'], 'km': row['km'], 'km2': row['km2'], 'prov': row['prov'], 'dir': row['dir'],
                      'len': round(abs(row['km2'] - row['km']), 1), 'valid_from': _iso(row.get('date', '')),
                      'a': (la[0], la[1]), 'b': (lb[0], lb[1])})

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
    return points, sections, {'zones': zones, 'zones_missing': zones_missing, 'rejected': rejected}


def _iso(d: str) -> str:
    """'03/08/2026' -> '2026-08-03'."""
    p = d.split('/')
    return f'{p[2]}-{p[1]}-{p[0]}' if len(p) == 3 else ''
