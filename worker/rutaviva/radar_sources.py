"""Regional and live speed-enforcement sources, parsed with our own code from the original publishers:

- Servei Català de Trànsit (SCT): fixed and average-speed cameras (`radars.txt`) and the spots where
  its trailer radars are placed (`radars-remolc.txt`). Plain text with ETRS89 / UTM 31N coordinates.
- DGT variable message signs that announce a speed check right now ("CONTROL MOVIL DE VELOCIDAD").
"""
from __future__ import annotations

import math
import re
from typing import Any

SCT = 'https://transit.gencat.cat/web/.content/documents/seguretat_viaria'
SCT_FILES = {'sct_fijos': f'{SCT}/radars.txt', 'sct_remolque': f'{SCT}/radars-remolc.txt'}

# ---------------------------------------------------------------- coordinates

_A = 6378137.0                 # GRS80 (ETRS89); differs from WGS84 by well under a metre
_F = 1 / 298.257222101
_K0 = 0.9996


def utm_to_lonlat(x: float, y: float, zone: int = 31) -> tuple[float, float]:
    """Inverse transverse Mercator (northern hemisphere), Snyder's series: millimetre accuracy in a zone."""
    e2 = _F * (2 - _F)
    ep2 = e2 / (1 - e2)
    m = y / _K0
    mu = m / (_A * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    n1 = _A / math.sqrt(1 - e2 * s * s)
    t1 = t * t
    c1 = ep2 * c * c
    r1 = _A * (1 - e2) / (1 - e2 * s * s) ** 1.5
    d = (x - 500000.0) / (n1 * _K0)
    lat = phi1 - (n1 * t / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                  + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / c
    return round(math.degrees(lon) + (zone * 6 - 183), 6), round(math.degrees(lat), 6)


# Rough outline of Catalonia, a few km out to sea and over the borders (it only rejects absurd values).
CATALONIA = [(0.15, 40.72), (0.52, 40.45), (0.95, 40.62), (1.6, 41.1), (2.3, 41.25), (3.3, 41.8), (3.45, 42.35), (3.2, 42.5),
             (2.65, 42.42), (2.0, 42.45), (1.75, 42.6), (1.42, 42.67), (1.0, 42.85), (0.62, 42.9), (0.6, 42.65), (0.65, 42.3),
             (0.55, 42.0), (0.3, 41.75), (0.25, 41.45), (0.18, 41.0)]


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


def _num(s: str) -> float | None:
    s = s.strip().replace(' ', '')
    if not s:
        return None
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


def _candidates(raw: str, lo: float, hi: float) -> list[tuple[float, bool]]:
    """The value as written, plus repairs of typical typing errors, as (value, repaired): a missing or
    misplaced decimal comma ("42552972" for 425529,72; "3401992,722" for 340199,2722) or a stray
    leading digit. Only values within [lo, hi] are kept."""
    s = raw.strip().replace(' ', '')
    v = _num(s)
    out: list[tuple[float, bool]] = []
    if v is not None and lo <= v <= hi:
        return [(v, False)]
    digits = re.sub(r'\D', '', s)
    if digits:
        for cut in range(5, min(len(digits), 8)):
            c = float(f'{digits[:cut]}.{digits[cut:] or 0}')
            if lo <= c <= hi and all(abs(c - o) > 1 for o, _ in out):
                out.append((c, True))
        if len(digits) > 7:
            c = float(f'{digits[1:7]}.{digits[7:] or 0}')
            if lo <= c <= hi and all(abs(c - o) > 1 for o, _ in out):
                out.append((c, True))
    return out


def sct_points(xs: str, ys: str) -> list[tuple[float, float, bool]]:
    """Possible (lon, lat, repaired) positions from the SCT's X and Y columns, inside Catalonia.
    Repaired candidates are only trusted when the road and kilometre confirm them (see enforcement.py)."""
    out = []
    for x, rx in _candidates(xs, 250_000, 540_000):
        for y, ry in _candidates(ys, 4_480_000, 4_760_000):
            lon, lat = utm_to_lonlat(x, y)
            if inside(lon, lat, CATALONIA):
                out.append((lon, lat, rx or ry))
    exact = [c for c in out if not c[2]]
    return exact or out


ROMAN = {'1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI'}


def sct_road(raw: str) -> tuple[str, str]:
    """'C-32 nord' -> ('C-32', 'nord'); 'C-58cc' -> ('C-58', 'cc'); 'N-2' -> 'N-II' (as in OpenStreetMap)."""
    m = re.match(r'^\s*([A-Z]+)-?(\d+)([a-z]*)\s*(.*)$', raw.strip())
    if not m:
        return raw.strip(), ''
    pre, num, suf, rest = m.groups()
    if pre == 'N' and num in ROMAN:
        num = ROMAN[num]
    if len(suf) == 1:  # C-1412a, C-1412b are roads of their own; "cc" (central carriageway) is not
        num, suf = num + suf, ''
    return f'{pre}-{num}', ' '.join(x for x in (suf, rest.strip()) if x)


def _cols(line: str) -> list[str]:
    if '\t' in line:
        return [c for c in line.rstrip('\r\n').split('\t')]
    # radars.txt is fixed width: 12 characters per column.
    return [line[i:i + 12] for i in range(0, 48, 12)] + [line[48:]]


def parse_sct(text: str, kind: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Rows of radars.txt / radars-remolc.txt. A PK range ("501,5-506,5") is an average-speed section,
    in its direction of travel. `cands` are the possible positions (see sct_points); the choice and the
    rejection of absurd ones need the road index. Returns (rows, unreadable lines)."""
    rows: list[dict[str, Any]] = []
    bad: list[str] = []
    seen: set[tuple] = set()
    for line in text.splitlines():
        cols = _cols(line)
        if len(cols) < 3 or not re.match(r'^\s*[A-Z]+-?(?:\d|[IVX]+\b)', cols[0]):
            continue  # title, header or blank line
        road, note = sct_road(cols[0])
        pk = cols[1].strip()
        rng = re.fullmatch(r'([\d,.]+)\s*-\s*([\d,.]+)', pk)
        km = _num(rng.group(1)) if rng else _num(pk)
        km2 = _num(rng.group(2)) if rng else None
        if km is None:
            bad.append(f'{line.strip()}: PK ilegible')
            continue
        xs, ys = (cols[3] if len(cols) > 3 else ''), (cols[4] if len(cols) > 4 else '')
        key = (road, km, km2, xs.strip(), ys.strip())
        if key in seen:
            continue  # the same line twice
        seen.add(key)
        speed = _num(cols[2])
        rows.append({'road': road, 'note': note, 'km': km, 'km2': km2, 'maxspeed': int(speed) if speed and 20 <= speed <= 130 else None,
                     'kind': 'tramo' if km2 is not None and kind == 'fijo' else kind, 'cands': sct_points(xs, ys),
                     'raw': ' '.join(line.split())})
    return rows, bad


# ---------------------------------------------------------------- DGT message signs announcing a speed check

_CHECK = re.compile(r'RADAR|CONTROL\w*\s+(?:MOVIL|MOBIL)|C\w?NTROL\w*\s+(?:DE\s+)?VELOCIDADE?|VELOCI(?:DAD|DADE|TAT)\s+CONTROLADA|CINEMOMETRO')
_AHEAD = re.compile(r'\b(?:A|EN)\s+(\d+(?:[.,]\d+)?)\s*(KM|M)\b')


def speed_check(lines: list[str], picts: list[str]) -> dict[str, Any] | None:
    """What a panel announces: a mobile speed check, an average-speed section or a radar in general.
    The text decides (pictogram E17, the speed camera, also counts); a limit comes from an R-301 sign."""
    text = ' '.join(lines).upper()
    if not (_CHECK.search(text) or 'E17' in picts):
        return None
    kind = 'movil' if re.search(r'M[OÓ][VB]IL', text) else 'tramo' if 'TRAMO' in text else 'radar'
    limit = None
    for p in picts:
        m = re.fullmatch(r'R301(\d{2,3})[IO]?', p)
        if m:
            limit = int(m.group(1))
            break
    ahead = None
    m = _AHEAD.search(text)
    if m:
        v = float(m.group(1).replace(',', '.'))
        ahead = v if m.group(2) == 'KM' else round(v / 1000, 2)
    return {'kind': kind, 'limit': limit, 'ahead': ahead}


# ---------------------------------------------------------------- Madrid (Ayuntamiento): fixed and average-speed cameras

MADRID_RADARS = ('https://datos.madrid.es/dataset/300049-0-radares-fijos-moviles/resource/300049-1-radares-fijos-moviles-csv/'
                 'download/300049-1-radares-fijos-moviles-csv.csv')


def parse_madrid(data: bytes) -> list[dict[str, Any]]:
    """datos.madrid.es dataset 300049 (one row per camera; sections with start and end).
    Columns: Nº RADAR; Ubicacion; Carretara o vial; ...; Tipo; ...; Longitud inicio tramo; Latitud inicio tramo; ...;
    Longitud; Latitud; Velocidad límite; Responsable."""
    import csv
    import io
    text = data.decode('utf-8-sig', 'replace')
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter=';'):
        r = {(k or '').strip().lower(): (v or '').strip() for k, v in r.items()}
        lon, lat = _num(r.get('longitud', '')), _num(r.get('latitud', ''))
        if lon is None or lat is None or not (-3.95 < lon < -3.5 and 40.3 < lat < 40.65):
            continue
        tramo = 'tramo' in r.get('tipo', '').lower()
        speed = _num(r.get('velocidad límite', ''))
        item = {'id': f"madrid:{r.get('nº radar', '')}", 'kind': 'tramo' if tramo else 'fijo', 'src': 'madrid',
                'road': r.get('carretara o vial', ''), 'prov': 'Madrid',
                'maxspeed': int(speed) if speed else None, 'note': r.get('ubicacion', ''),
                'dir': r.get('sentido', ''), 'lon': lon, 'lat': lat}
        if tramo:
            a = (_num(r.get('longitud inicio tramo', '')), _num(r.get('latitud inicio tramo', '')))
            if a[0] is not None and a[1] is not None:
                # The file gives the section's start and its end (the camera that measures the average).
                item['end'] = (lon, lat)
                item['lon'], item['lat'] = a[0], a[1]
        out.append(item)
    return out
