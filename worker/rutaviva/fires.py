"""Wildfires: satellite heat spots (NASA FIRMS, VIIRS, public CSV without key; the last 7 days are
read, the last 48 h shown) and the
areas burnt in the last 30 days (Copernicus EFFIS). Both cover Europe; we keep Spain.

Heat spots are not always wildfires: agricultural burns and industry (steelworks, refineries) also
show up. Spots that repeat in the same place on many different days are marked `persistent` and
hidden by default, since they are almost always factories."""
from __future__ import annotations

import csv
import datetime as dt
import io
import math
import re
from typing import Any

FIRMS = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire'
FIRMS_FILES = {
    'S-NPP': f'{FIRMS}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_7d.csv',
    'NOAA-20': f'{FIRMS}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_7d.csv',
    'NOAA-21': f'{FIRMS}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_7d.csv',
}
# WFS 1.1.0 with EPSG:4326 uses latitude, longitude order.
EFFIS = ('https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0&request=GetFeature'
         '&typename=ms:modis.ba.poly.month&bbox=27,-19,44.5,5,EPSG:4326&maxfeatures=2000')

# Rough outline of mainland Spain (pushed a little out to sea), to drop Portugal, France and Morocco.
MAINLAND = [(-9.6, 43.0), (-9.4, 43.6), (-8.0, 44.0), (-4.5, 43.8), (-1.78, 43.39), (-1.4, 43.05), (-0.7, 42.82),
            (0.7, 42.82), (1.45, 42.58), (1.98, 42.43), (3.2, 42.43), (3.6, 42.3), (3.6, 41.8), (2.4, 41.0),
            (1.0, 40.5), (0.3, 39.9), (0.5, 38.7), (-0.4, 37.9), (-1.4, 37.4), (-2.1, 36.55), (-4.4, 36.45),
            (-5.4, 35.9), (-6.2, 36.05), (-6.6, 36.8), (-7.42, 37.12), (-7.5, 37.5), (-7.25, 38.2), (-7.0, 38.9),
            (-7.45, 39.6), (-6.9, 40.25), (-6.8, 41.0), (-6.2, 41.6), (-6.6, 41.95), (-7.9, 41.85), (-8.2, 42.12),
            (-8.9, 41.85), (-9.3, 42.3)]
ISLANDS = [(1.1, 38.5, 4.5, 40.2), (-18.4, 27.5, -13.2, 29.5)]  # Balearic and Canary Islands (bbox)


def inside(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def in_spain(lon: float, lat: float) -> bool:
    return inside(lon, lat, MAINLAND) or any(a <= lon <= c and b <= lat <= d for a, b, c, d in ISLANDS)


def hotspots(files: dict[str, bytes]) -> list[dict[str, Any]]:
    out = []
    for sat, data in files.items():
        for row in csv.DictReader(io.StringIO(data.decode('utf-8', 'replace'))):
            try:
                lat, lon = float(row['latitude']), float(row['longitude'])
                frp = float(row.get('frp') or 0)
            except (KeyError, ValueError):
                continue
            conf = (row.get('confidence') or '').lower()
            if conf.startswith('l') or not in_spain(lon, lat):
                continue
            t = (row.get('acq_time') or '0000').zfill(4)
            out.append({'lon': lon, 'lat': lat, 'frp': frp, 'sat': sat,
                        'when': f"{row.get('acq_date', '')}T{t[:2]}:{t[2:]}:00Z", 'night': row.get('daynight') == 'N'})
    return out


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 85, (a[1] - b[1]) * 111)


def cluster(spots: list[dict[str, Any]], radius_km: float = 1.5) -> list[dict[str, Any]]:
    """One marker per fire: spots within `radius_km` of each other are merged."""
    groups: list[dict[str, Any]] = []
    for s in sorted(spots, key=lambda s: -s['frp']):
        for g in groups:
            if _km((s['lon'], s['lat']), (g['lon'], g['lat'])) <= radius_km:
                g['n'] += 1
                g['frp'] += s['frp']
                g['last'] = max(g['last'], s['when'])
                g['first'] = min(g['first'], s['when'])
                break
        else:
            groups.append({'lon': s['lon'], 'lat': s['lat'], 'n': 1, 'frp': s['frp'], 'first': s['when'], 'last': s['when']})
    for g in groups:
        g['frp'] = round(g['frp'], 1)
        g['id'] = f"fire:{g['lon']:.3f}:{g['lat']:.3f}"
    return groups


def cell(lon: float, lat: float) -> str:
    return f'{round(lon * 50)}:{round(lat * 50)}'  # ~1.7 km


def record(spots: list[dict[str, Any]], history: dict[str, list[str]], today: dt.date) -> dict[str, list[str]]:
    """Days on which each ~1.7 km cell had a heat spot, for the last 60 days."""
    keep_from = (today - dt.timedelta(days=60)).isoformat()
    hist = {k: {d for d in v if d >= keep_from} for k, v in history.items()}
    for s in spots:
        hist.setdefault(cell(s['lon'], s['lat']), set()).add(s['when'][:10])
    return {k: sorted(v) for k, v in hist.items() if v}


def mark_persistent(groups: list[dict[str, Any]], hist: dict[str, list[str]]) -> None:
    """Flag fires seen around the same spot on 5 or more different days with little power: chimneys
    (steelworks, refineries) rather than wildfires. A large wildfire that lasts days keeps a high FRP."""
    for g in groups:
        near: set[str] = set()
        cx, cy = (int(x) for x in cell(g['lon'], g['lat']).split(':'))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near.update(hist.get(f'{cx + dx}:{cy + dy}', []))
        g['days'] = len(near)
        g['persistent'] = len(near) >= 5 and g['frp'] < 60


def burnt(xml: bytes) -> list[dict[str, Any]]:
    """EFFIS burnt areas (GML 3.1.1, lat lon order) in Spain."""
    s = xml.decode('utf-8', 'replace')
    out = []
    for m in re.finditer(r'<gml:featureMember>(.*?)</gml:featureMember>', s, re.S):
        b = m.group(1)

        def tag(name: str) -> str:
            t = re.search(rf'<ms:{name}>([^<]*)</ms:{name}>', b)
            return t.group(1).strip() if t else ''
        if tag('COUNTRY') != 'ES':
            continue
        rings = []
        for pl in re.findall(r'<gml:posList[^>]*>([^<]*)</gml:posList>', b):
            nums = [float(x) for x in pl.split()]
            ring = [[round(nums[i + 1], 5), round(nums[i], 5)] for i in range(0, len(nums) - 1, 2)]
            if len(ring) >= 4:
                rings.append(ring)
        if not rings:
            continue
        area = tag('AREA_HA')
        out.append({'id': f"effis:{tag('id')}", 'rings': rings, 'area': float(area) if area else None,
                    'date': tag('FIREDATE')[:10], 'updated': tag('LASTUPDATE')[:10],
                    'place': ', '.join(x for x in (tag('COMMUNE'), tag('PROVINCE')) if x and x != 'N.A.')})
    return out
