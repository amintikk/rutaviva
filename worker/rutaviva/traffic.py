"""Live traffic state where cities publish it as open data (the DGT incident feed carries almost no
congestion): Madrid's ~4,900 road sensors and Barcelona's ~530 street sections, every 5 minutes.

Everything is normalised to one scale: 1 fluido, 2 denso, 3 muy denso, 4 congestión, 5 cortado
(0 = sin datos)."""
from __future__ import annotations

import csv
import io
import math
import re
from typing import Any

MADRID = 'https://informo.madrid.es/informo/tmadrid/pm.xml'
BCN_STATE = ('https://opendata-ajuntament.barcelona.cat/data/dataset/8319c2b1-4c21-4962-9acd-6db4c5ff1148/'
             'resource/2d456eb5-4ea6-4f68-9794-2f3f1a58a933/download')
BCN_SECTIONS = ('https://opendata-ajuntament.barcelona.cat/data/dataset/1090983a-1c40-4609-8620-14ad49aae3ab/'
                'resource/1d6c814c-70ef-4147-aa16-a49ddb952f72/download/transit_relacio_trams.csv')

LABEL = {0: 'Sin datos', 1: 'Fluido', 2: 'Denso', 3: 'Muy denso', 4: 'Congestión', 5: 'Cortado'}


def utm_to_wgs84(x: float, y: float, zone: int = 30) -> tuple[float, float]:
    """ETRS89 / UTM (northern hemisphere) to longitude, latitude (GRS80 ~ WGS84 at this precision)."""
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    x -= 500000.0
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    n1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    t1 = math.tan(phi1) ** 2
    c1 = ep2 * math.cos(phi1) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                              + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(phi1)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    return round(math.degrees(lon0 + lon), 6), round(math.degrees(lat), 6)


def _tag(block: str, name: str) -> str:
    m = re.search(rf'<{name}>(.*?)</{name}>', block, re.S)
    return m.group(1).strip() if m else ''


def madrid(xml: bytes) -> tuple[str, list[dict[str, Any]]]:
    """Madrid sensors: nivelServicio 0 fluido, 1 lento, 2 retenciones, 3 congestión."""
    s = xml.decode('utf-8', 'replace')
    stamp = _tag(s, 'fecha_hora')
    out = []
    for b in re.findall(r'<pm>(.*?)</pm>', s, re.S):
        if _tag(b, 'error') not in ('N', ''):
            continue
        try:
            x = float(_tag(b, 'st_x').replace(',', '.'))
            y = float(_tag(b, 'st_y').replace(',', '.'))
            lvl = int(_tag(b, 'nivelServicio') or -1)
        except ValueError:
            continue
        if lvl < 0 or lvl > 3:
            continue
        lon, lat = utm_to_wgs84(x, y)
        out.append({'id': f"mad:{_tag(b, 'idelem')}", 'lon': lon, 'lat': lat, 'state': {0: 1, 1: 2, 2: 3, 3: 4}[lvl],
                    'name': _tag(b, 'descripcion').title()[:120], 'load': int(_tag(b, 'carga') or 0),
                    'flow': int(_tag(b, 'intensidad') or 0)})
    return stamp, out


def barcelona(sections_csv: bytes, state: bytes) -> tuple[str, list[dict[str, Any]]]:
    """Barcelona sections: estat 0 sense dades, 1 molt fluid, 2 fluid, 3 dens, 4 molt dens, 5 congestió, 6 tallat."""
    geo: dict[str, tuple[str, list[list[float]]]] = {}
    for row in csv.DictReader(io.StringIO(sections_csv.decode('utf-8-sig', 'replace'))):
        nums = [float(v) for v in row.get('Coordenades', '').split(',') if v.strip()]
        pts = [[round(nums[i], 6), round(nums[i + 1], 6)] for i in range(0, len(nums) - 1, 2)]
        if len(pts) >= 2:
            geo[row['Tram'].strip()] = (row.get('Descripció', ''), pts)
    out = []
    stamp = ''
    for line in state.decode('utf-8', 'replace').splitlines():
        parts = line.strip().split('#')
        if len(parts) < 4 or parts[0] not in geo:
            continue
        stamp = stamp or parts[1]
        now = int(parts[2]) if parts[2].isdigit() else 0
        if now == 0:
            continue
        name, pts = geo[parts[0]]
        out.append({'id': f'bcn:{parts[0]}', 'line': pts, 'name': name,
                    'state': {1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}.get(now, 0)})
    return stamp, out
