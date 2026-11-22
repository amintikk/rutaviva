"""What the OpenStreetMap community maps about road enforcement, read from the Spain extract that
Valhalla already uses (no extra download):

- speed cameras (`highway=speed_camera`), with their speed limit and direction;
- average-speed sections (`type=enforcement` + `enforcement=average_speed`), with the exact road
  geometry of the section and its limit;
- red-light cameras (`enforcement=traffic_signals` / `red_light_camera`);
- kilometre posts (`highway=milestone` with `ref` and `distance`), used to place the DGT's
  "road + kilometre" lists on the map;
- toll roads (`toll=yes`), toll booths (`barrier=toll_booth`) and service / rest areas
  (`highway=services` / `rest_area`).
"""
from __future__ import annotations

import math
import os
import re
from pathlib import Path
from typing import Any

PBF = Path(os.environ.get('RUTAVIVA_OSM_PBF', '/osm/spain-latest.osm.pbf'))


def road_key(ref: str) -> str:
    """Comparable road name: "A-31", "A31" and "a 31" are the same road; "EX-A1" == "EXA1"."""
    return re.sub(r'[^A-Z0-9]', '', ref.upper())


def _num(s: str | None) -> float | None:
    if not s:
        return None
    m = re.match(r'^\s*(\d+(?:[.,]\d+)?)', s)
    return float(m.group(1).replace(',', '.')) if m else None


def read(pbf: Path = PBF) -> dict[str, Any]:
    import osmium  # imported lazily: only this job needs it

    cams: list[dict[str, Any]] = []
    milestones: list[tuple[str, float, float, float]] = []
    lights: list[dict[str, Any]] = []
    booths: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []
    # Pass 1: nodes we need directly (cameras, milestones, toll booths, service areas mapped as a point).
    for n in osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(osmium.filter.KeyFilter('highway', 'barrier')):
        if n.tags.get('barrier') == 'toll_booth':
            booths.append({'id': f'osm:{n.id}', 'lon': round(n.location.lon, 6), 'lat': round(n.location.lat, 6),
                           'name': n.tags.get('name', '')[:80], 'op': n.tags.get('operator', '')[:80]})
            continue
        hw = n.tags.get('highway')
        if hw in ('services', 'rest_area'):
            services.append(_service(f'osm:{n.id}', n.tags, (round(n.location.lon, 6), round(n.location.lat, 6))))
            continue
        if hw == 'speed_camera':
            t = {tag.k: tag.v for tag in n.tags}
            ms = t.get('maxspeed', '')
            note = (t.get('note') or t.get('description') or '')
            cams.append({
                'id': f'osm:{n.id}', 'lon': round(n.location.lon, 6), 'lat': round(n.location.lat, 6),
                'maxspeed': int(ms) if ms.isdigit() else None, 'direction': t.get('direction', ''), 'note': note[:160],
                'kind': 'semaforo' if 'semáforo' in note.lower() or 'semaforo' in note.lower() else 'fijo',
                'temporary': t.get('temporary') == 'yes',
            })
        elif hw == 'milestone':
            d = _num(n.tags.get('distance') or n.tags.get('pk'))
            ref = n.tags.get('ref') or n.tags.get('highway:ref') or ''
            if d is not None and ref:
                for r in ref.split(';'):
                    milestones.append((road_key(r), d, round(n.location.lon, 6), round(n.location.lat, 6)))
    # Pass 2: enforcement relations and the members we need to resolve.
    rels = []
    need_nodes: set[int] = set()
    need_ways: set[int] = set()
    for r in osmium.FileProcessor(str(pbf), osmium.osm.RELATION).with_filter(osmium.filter.TagFilter(('type', 'enforcement'))):
        enf = r.tags.get('enforcement', '')
        if enf not in ('average_speed', 'traffic_signals', 'red_light_camera'):
            continue
        members = [(m.type, m.role, m.ref) for m in r.members]
        rels.append({'id': r.id, 'enf': enf, 'tags': {t.k: t.v for t in r.tags}, 'members': members})
        for typ, _role, ref in members:
            (need_nodes if typ == 'n' else need_ways if typ == 'w' else set()).add(ref)
    way_nodes: dict[int, list[int]] = {}
    way_ref: dict[int, str] = {}
    if need_ways:
        for w in osmium.FileProcessor(str(pbf), osmium.osm.WAY).with_filter(osmium.filter.IdFilter(need_ways)):
            way_nodes[w.id] = [nd.ref for nd in w.nodes]
            way_ref[w.id] = w.tags.get('ref', '')
            need_nodes.update(way_nodes[w.id])
    # Toll roads and service areas mapped as an area.
    toll_ways: list[dict[str, Any]] = []
    area_ways: list[tuple[int, Any, list[int]]] = []
    for w in osmium.FileProcessor(str(pbf), osmium.osm.WAY).with_filter(
            osmium.filter.TagFilter(('toll', 'yes'), ('highway', 'services'), ('highway', 'rest_area'))):
        hw = w.tags.get('highway', '')
        nodes = [nd.ref for nd in w.nodes]
        if hw in ('services', 'rest_area'):
            area_ways.append((w.id, {t.k: t.v for t in w.tags}, nodes))
        elif w.tags.get('toll') == 'yes' and hw in TOLL_HIGHWAYS:
            toll_ways.append({'id': w.id, 'ref': w.tags.get('ref', ''), 'name': w.tags.get('name', '')[:80],
                              'op': w.tags.get('operator', '')[:80], 'hw': hw, 'nodes': nodes})
        else:
            continue
        need_nodes.update(nodes)
    loc: dict[int, tuple[float, float]] = {}
    if need_nodes:
        for n in osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need_nodes)):
            loc[n.id] = (round(n.location.lon, 6), round(n.location.lat, 6))
    sections: list[dict[str, Any]] = []
    for r in rels:
        pts = {role: loc.get(ref) for typ, role, ref in r['members'] if typ == 'n' and role in ('from', 'to')}
        devices = [loc[ref] for typ, role, ref in r['members'] if typ == 'n' and role == 'device' and ref in loc]
        if r['enf'] != 'average_speed':
            for d in devices or [p for p in pts.values() if p]:
                lights.append({'id': f"osmrel:{r['id']}", 'lon': d[0], 'lat': d[1], 'kind': 'semaforo'})
            continue
        lines = [[loc[n] for n in way_nodes.get(ref, []) if n in loc] for typ, role, ref in r['members'] if typ == 'w' and role == 'section']
        refs = sorted({way_ref.get(ref, '') for typ, role, ref in r['members'] if typ == 'w'} - {''})
        frm, to = pts.get('from'), pts.get('to')
        if not frm or not to:
            continue
        sections.append({
            'id': f"osmrel:{r['id']}", 'from': frm, 'to': to, 'lines': [ln for ln in lines if len(ln) > 1],
            'maxspeed': int(r['tags']['maxspeed']) if r['tags'].get('maxspeed', '').isdigit() else None,
            'road': refs[0].split(';')[0] if refs else '', 'note': (r['tags'].get('description') or r['tags'].get('name') or '')[:160],
        })
    tolls = []
    for t in toll_ways:
        line = simplify([loc[n] for n in t.pop('nodes') if n in loc], 0.0002)
        if len(line) > 1:
            tolls.append({**t, 'line': line})
    for wid, tags, nodes in area_ways:
        pts = [loc[n] for n in nodes if n in loc]
        if pts:
            c = (round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6))
            services.append(_service(f'osmw:{wid}', tags, c))
    return {'cameras': cams, 'milestones': milestones, 'sections': sections, 'lights': lights,
            'tolls': tolls, 'booths': booths, 'services': services}


TOLL_HIGHWAYS = ('motorway', 'trunk', 'primary', 'secondary')


def _service(id_: str, tags: Any, pt: tuple[float, float]) -> dict[str, Any]:
    get = tags.get
    return {'id': id_, 'lon': pt[0], 'lat': pt[1], 'kind': get('highway'), 'name': (get('name') or '')[:80],
            'brand': (get('brand') or get('operator') or '')[:60]}


def simplify(line: list[tuple[float, float]], tol: float) -> list[list[float]]:
    """Douglas-Peucker in degrees (0.0002 ~ 20 m): enough detail to draw a road at any zoom."""
    if len(line) < 3:
        return [list(p) for p in line]
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = line[a], line[b]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            x, y = line[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / n
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [list(p) for p, k in zip(line, keep) if k]


def speed_cameras(pbf: Path = PBF) -> list[dict[str, Any]]:
    return read(pbf)['cameras']


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 85, (a[1] - b[1]) * 111)


def merge(dgt: list[dict[str, Any]], osm: list[dict[str, Any]], radius_km: float = 0.15) -> tuple[list[dict], list[dict]]:
    """Give DGT radars the speed limit of the OSM camera at the same spot, and return the OSM
    cameras that the DGT list does not have (within `radius_km`)."""
    grid: dict[tuple[int, int], list[dict]] = {}
    for o in osm:
        grid.setdefault((int(o['lon'] * 200), int(o['lat'] * 200)), []).append(o)
    matched: set[str] = set()
    for r in dgt:
        cx, cy = int(r['lon'] * 200), int(r['lat'] * 200)
        best, bd = None, radius_km
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in grid.get((cx + dx, cy + dy), []):
                    d = _km((r['lon'], r['lat']), (o['lon'], o['lat']))
                    if d <= bd:
                        best, bd = o, d
        if best:
            matched.add(best['id'])
            if best.get('maxspeed') and not r.get('maxspeed'):
                r['maxspeed'] = best['maxspeed']
    extra = [o for o in osm if o['id'] not in matched and not o.get('temporary')]
    return dgt, extra


if __name__ == '__main__':
    # One-off job (deploy.sh runs it in its own container when the extract changes): it needs
    # ~1.7 GB for a couple of minutes, more than the long-running worker should hold.
    import json
    import sys
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '/data/osm-enforcement.json')
    data = read()
    tmp = out.with_suffix('.tmp')
    tmp.write_text(json.dumps(data))
    tmp.replace(out)
    print({k: len(v) for k, v in data.items()})
