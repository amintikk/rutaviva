"""Speed cameras mapped by the OpenStreetMap community, read from the Spain extract that Valhalla
already uses (no extra download). They complete the DGT list, which leaves out Catalonia, the
Basque Country, municipal and red-light cameras, and add the speed limit the DGT omits."""
from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

PBF = Path(os.environ.get('RUTAVIVA_OSM_PBF', '/osm/spain-latest.osm.pbf'))


def speed_cameras(pbf: Path = PBF) -> list[dict[str, Any]]:
    import osmium  # imported lazily: only this job needs it

    out = []
    fp = osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(osmium.filter.TagFilter(('highway', 'speed_camera')))
    for n in fp:
        t = {tag.k: tag.v for tag in n.tags}
        ms = t.get('maxspeed', '')
        out.append({
            'id': f'osm:{n.id}', 'lon': round(n.location.lon, 6), 'lat': round(n.location.lat, 6),
            'maxspeed': int(ms) if ms.isdigit() else None,
            'direction': t.get('direction', ''),
            'note': (t.get('note') or t.get('description') or '')[:160],
            'kind': 'semaforo' if 'traffic_signals' in t.get('enforcement', '') or 'semáforo' in t.get('note', '').lower() or 'semaforo' in t.get('note', '').lower() else 'fijo',
            'temporary': t.get('temporary') == 'yes',
        })
    return out


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
