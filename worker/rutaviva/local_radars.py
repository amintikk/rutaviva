"""Mobile speed checks announced by city councils, and recurring mobile-radar spots learnt from the
published speeding fines. Own code, reading each council's original publication:

- Donostia / San Sebastián: the page of today's mobile radar (coordinates included). Reuse allowed
  quoting the source (Ley 37/2007, aviso legal of donostia.eus).
- León: a monthly PDF (day, morning/afternoon, street). Parsed and geocoded, but only published when
  RUTAVIVA_LEON=1: its terms do not allow reuse without the council's permission.
- Barcelona and Madrid fines (CC BY 4.0): places where speeding fines come in short sessions on a few
  days, not all day long (that is a fixed camera). Months behind: shown as historical risk zones.

Streets are placed with OpenStreetMap (Overpass), then CartoCiudad (IGN), then Nominatim, and drawn as
a chain of circles along the street; the ones not found are left out and listed in sources.json.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
import re
import statistics
import unicodedata
from typing import Any, Awaitable, Callable

# ---------------------------------------------------------------- geometry

def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    kx = math.cos(math.radians((a[1] + b[1]) / 2)) * 111.32
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57)


def circle(c: tuple[float, float], r_km: float, n: int = 20) -> list[list[float]]:
    kx = math.cos(math.radians(c[1])) * 111.32
    ring = [[round(c[0] + r_km * math.cos(2 * math.pi * i / n) / kx, 6), round(c[1] + r_km * math.sin(2 * math.pi * i / n) / 110.57, 6)]
            for i in range(n)]
    return ring + [ring[0]]


def along(lines: list[list[tuple[float, float]]], step_km: float = 0.25) -> list[tuple[float, float]]:
    """Points every `step_km` along the lines (ends included), without repeating close ones."""
    pts: list[tuple[float, float]] = []
    for ln in lines:
        if not ln:
            continue
        pts.append(tuple(ln[0]))
        acc = 0.0
        for a, b in zip(ln, ln[1:]):
            d = _km(tuple(a), tuple(b))
            while acc + d >= step_km and d > 0:
                t = (step_km - acc) / d
                a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                pts.append(a)
                d = _km(a, tuple(b))
                acc = 0.0
            acc += d
        pts.append(tuple(ln[-1]))
    out: list[tuple[float, float]] = []
    for p in pts:
        if all(_km(p, q) > step_km * 0.5 for q in out):
            out.append((round(p[0], 6), round(p[1], 6)))
    return out


def circles(lines: list[list[tuple[float, float]]], r_km: float = 0.15, step_km: float = 0.25, limit: int = 60) -> dict:
    """MultiPolygon of circles covering a street (or one circle for a point)."""
    pts = along(lines, step_km)[:limit]
    return {'type': 'MultiPolygon', 'coordinates': [[circle(p, r_km)] for p in pts]}


# ---------------------------------------------------------------- street names

ABBR = {'AV': 'Avenida', 'AVDA': 'Avenida', 'PO': 'Paseo', 'Pº': 'Paseo', 'P.º': 'Paseo', 'RD': 'Ronda', 'CR': 'Carretera',
        'CTRA': 'Carretera', 'GT': 'Glorieta', 'PZ': 'Plaza', 'PL': 'Plaza', 'CL': 'Calle', 'C/': 'Calle', 'CO': 'Costanilla',
        'DR': 'Doctor', 'STA': 'Santa', 'STO': 'Santo', 'S': 'San', 'TR': 'Travesía', 'CM': 'Camino'}
TYPES = ('calle', 'avenida', 'paseo', 'ronda', 'carretera', 'glorieta', 'plaza', 'travesia', 'camino', 'costanilla', 'carrer',
         'avinguda', 'passeig', 'kalea', 'etorbidea', 'pasealekua')


def fold(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')


def expand(street: str) -> str:
    """'AV RAMON Y CAJAL' -> 'Avenida Ramon Y Cajal'; 'P.º Condesa' -> 'Paseo Condesa'."""
    words = street.replace('Avda.', 'AVDA').replace('Ctra.', 'CTRA').replace('Dr.', 'DR').split()
    out = []
    for i, w in enumerate(words):
        key = w.rstrip('.').upper()
        out.append(ABBR[key] if (i == 0 or key in ('DR', 'STA', 'STO')) and key in ABBR else w)
    titled = ' '.join(w.upper() if re.fullmatch(r'[IVXL]+', w.upper()) and len(w) > 1 else w.title() for w in ' '.join(out).split())
    return re.sub(r' (De|Del|La|Las|Los|El|Y) ', lambda m: f' {m.group(1).lower()} ', titled)


def core(name: str) -> str:
    """The distinctive part of a street name, for matching: without type, articles or accents."""
    w = fold(name).replace('.', ' ').split()
    while w and (w[0] in TYPES or w[0] in ('de', 'del', 'la', 'el', 'los', 'las', "d'", 'dels')):
        w = w[1:]
    return ' '.join(w)


def _accent_rx(text: str) -> str:
    groups = {'a': '[aáà]', 'e': '[eéè]', 'i': '[iíï]', 'o': '[oóò]', 'u': '[uúü]', 'n': '[nñ]', 'c': '[cç]'}
    return ''.join(groups.get(c, re.escape(c)) for c in fold(text))


class Geocoder:
    """Street -> lines. OSM first (exact street geometry), CartoCiudad next, Nominatim last (a point).
    `fetch(url, data=None)` returns the body; results are cached by the caller-provided `cache`."""

    def __init__(self, fetch: Callable[..., Awaitable[bytes]], cache: dict[str, Any]) -> None:
        self.fetch = fetch
        self.cache = cache

    async def street(self, name: str, city: str, bbox: tuple[float, float, float, float]) -> tuple[list[list[tuple[float, float]]], str]:
        key = f'{fold(city)}|{fold(name)}'
        if key in self.cache:
            v = self.cache[key]
            return [[tuple(p) for p in ln] for ln in v['lines']], v['src']
        lines, src = [], ''
        for fn, label in ((self._overpass, 'OpenStreetMap'), (self._cartociudad, 'CartoCiudad'), (self._nominatim, 'Nominatim')):
            try:
                lines = await fn(name, city, bbox)
            except Exception:  # noqa: BLE001 - try the next geocoder
                lines = []
            if lines:
                src = label
                break
        self.cache[key] = {'lines': lines, 'src': src, 'at': dt.date.today().isoformat()}
        return lines, src

    async def _overpass(self, name: str, city: str, bbox: tuple[float, float, float, float]) -> list[list[tuple[float, float]]]:
        w, s, e, n = bbox
        c = core(name)
        if not c:
            return []
        road = re.fullmatch(r'([a-z]+)-?(\d+)', c.replace(' ', ''))
        sel = (f'way["highway"]["ref"~"^{road.group(1).upper()}-?{road.group(2)}$"]' if road
               else f'way["highway"]["name"~"{_accent_rx(c)}$",i]')
        q = f'[out:json][timeout:25];{sel}({s},{w},{n},{e});out geom 400;'
        data = json.loads(await self.fetch('https://overpass-api.de/api/interpreter', data={'data': q}))
        lines = [[(round(p['lon'], 6), round(p['lat'], 6)) for p in el.get('geometry', [])] for el in data.get('elements', [])]
        # The name must match as a whole (not "Alfonso XIII" for "Alfonso XII").
        keep = [ln for el, ln in zip(data.get('elements', []), lines)
                if len(ln) > 1 and (road or core(el.get('tags', {}).get('name', '')) == c)]
        return keep

    async def _cartociudad(self, name: str, city: str, bbox: tuple[float, float, float, float]) -> list[list[tuple[float, float]]]:
        from urllib.parse import quote
        body = await self.fetch(f'https://www.cartociudad.es/geocoder/api/geocoder/candidatesJsonp?q={quote(f"{name}, {city}")}&limit=5')
        cands = json.loads(re.sub(r'^\s*callback\(|\)\s*;?\s*$', '', body.decode('utf-8', 'replace')))
        c = core(name)
        for cand in cands:
            if cand.get('type') != 'callejero' or fold(cand.get('muni', '')) != fold(city):
                continue
            if core(cand.get('address', '').split(',')[0]) != c:
                continue
            from urllib.parse import urlencode
            found = await self.fetch('https://www.cartociudad.es/geocoder/api/geocoder/findJsonp?' + urlencode({'q': f'{name}, {city}', 'id': cand['id'], 'type': 'callejero'}))
            j = json.loads(re.sub(r'^\s*callback\(|\)\s*;?\s*$', '', found.decode('utf-8', 'replace')))
            geom = j.get('geom') or ''
            lines = [[(round(float(x), 6), round(float(y), 6)) for x, y in (p.split() for p in part.split(','))]
                     for part in re.findall(r'\(([^()]+)\)', geom)]
            w, s, e, n = bbox
            lines = [ln for ln in lines if ln and all(w <= x <= e and s <= y <= n for x, y in ln[:1])]
            if lines:
                return lines
        return []

    async def _nominatim(self, name: str, city: str, bbox: tuple[float, float, float, float]) -> list[list[tuple[float, float]]]:
        from urllib.parse import urlencode
        w, s, e, n = bbox
        body = await self.fetch('https://nominatim.openstreetmap.org/search?' + urlencode(
            {'street': name, 'city': city, 'country': 'es', 'format': 'jsonv2', 'limit': 1, 'viewbox': f'{w},{n},{e},{s}', 'bounded': 1}))
        res = json.loads(body)
        return [[(round(float(res[0]['lon']), 6), round(float(res[0]['lat']), 6))]] if res else []


# ---------------------------------------------------------------- Donostia: today's mobile radar

DONOSTIA_JS = 'https://www.donostia.eus/info/ciudadano/radar_movil.nsf/javascript_geo.js'
DONOSTIA_PAGE = 'https://www.donostia.eus/info/ciudadano/radar_movil.nsf/fwHome?ReadForm&idioma=cas'


def parse_donostia(js: bytes) -> list[dict[str, Any]]:
    """The map script carries today's locations as a GeoJSON literal: `var puntos = {...};`
    with `attributes.tituloCas` / `tituloEus` (or `properties`), EPSG:4326."""
    text = js.decode('utf-8', 'replace') if b'\xc3' in js else js.decode('latin-1')
    m = re.search(r'var\s+puntos\s*=\s*(\{.*?\})\s*;\s*\n', text, re.S)
    if not m:
        raise ValueError('sin bloque de ubicaciones')
    data = json.loads(m.group(1))
    out = []
    for f in data.get('features', []):
        attrs = f.get('attributes') or f.get('properties') or {}
        g = f.get('geometry') or {}
        coords = g.get('coordinates')
        if not coords:
            continue
        t = g.get('type')
        lines = ([[tuple(coords)]] if t == 'Point' else [[tuple(p) for p in coords]] if t == 'LineString'
                 else [[tuple(p) for p in ln] for ln in coords] if t in ('MultiLineString', 'Polygon') else [])
        lines = [[p for p in ln if 1.85 < p[0] < 2.05 and 43.25 < p[1] < 43.35] for ln in lines]
        lines = [ln for ln in lines if ln]
        if lines:
            out.append({'title': str(attrs.get('tituloCas') or attrs.get('titulo') or '').strip(),
                        'title_eu': str(attrs.get('tituloEus') or '').strip(), 'lines': lines})
    return out


# ---------------------------------------------------------------- León: monthly list

LEON_NEWS = 'https://aytoleon.es/es/actualidad/noticias'
LEON_BBOX = (-5.65, 42.55, -5.5, 42.66)
MONTHS = {m: i for i, m in enumerate(('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
                                      'octubre', 'noviembre', 'diciembre'), 1)}


def leon_post(html: str) -> str | None:
    """Link of the newest news item "Ubicación de los radares móviles en el mes de …"."""
    for m in re.finditer(r'<a[^>]+href="([^"]*ViewPost\.aspx\?ID=\d+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        if re.search(r'radares\s+m[oó]viles', re.sub('<[^>]+>', '', m.group(2)), re.I):
            href = m.group(1).replace('&amp;', '&')
            return href if href.startswith('http') else 'https://aytoleon.es' + href
    return None


def leon_pdf(html: str) -> str | None:
    m = re.search(r'''["']([^"']*SiteAssets/Lists/EntradasDeBlog/[^"']*[Rr]adares[^"']*\.pdf)["']''', html)
    if not m:
        return None
    href = m.group(1).replace(' ', '%20')
    if href.startswith('http'):
        return href
    return 'https://aytoleon.es' + href if href.startswith('/') else 'https://aytoleon.es/es/actualidad/noticias/articulos/' + href.lstrip('./')


def parse_leon(text: str) -> tuple[int, int, list[dict[str, Any]]]:
    """(year, month, rows) from `pdftotext -layout`: «1 mañana Alcalde Miguel Castaño 30»; the day and
    the shift are only written on the first line of their block."""
    m = re.search(r'mes\s+de\s+(\w+)\s+de\s+(\d{4})', text, re.I)
    if not m or m.group(1).lower() not in MONTHS:
        raise ValueError('no se encuentra el mes')
    month, year = MONTHS[m.group(1).lower()], int(m.group(2))
    rows, day, shift = [], None, None
    for line in text.splitlines():
        r = re.match(r'^\s*(?:(\d{1,2})\s+)?(?:(mañana|tarde)\s+)?(\S.*?)\s+(\d{2,3})\s*$', line, re.I)
        if not r:
            continue
        if r.group(1):
            day = int(r.group(1))
        if r.group(2):
            shift = r.group(2).lower()
        if day is None or shift is None or not 1 <= day <= 31:
            continue
        place = r.group(3).strip()
        extra = re.search(r'\(([^)]*)\)', place)
        street = re.sub(r'\s*\([^)]*\)', '', place).strip()
        rows.append({'day': day, 'shift': shift, 'street': street, 'where': extra.group(1) if extra else '',
                     'maxspeed': int(r.group(4))})
    return year, month, rows


# ---------------------------------------------------------------- fines: recurring mobile-radar spots

BCN_PKG = 'https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=denuncies_sancions_transit_bcn_detall'
MADRID_PKG = 'https://datos.madrid.es/api/3/action/package_show?id=210104-0-multas-circulacion-detalle'
MADRID_BBOX = (-3.89, 40.31, -3.52, 40.64)


def latest_resource(pkg: bytes, pattern: str) -> tuple[str, str] | None:
    """(url, name) of the newest CSV resource whose name matches `pattern` (names sort by date)."""
    res = json.loads(pkg).get('result', {}).get('resources', [])
    cands = sorted(((r.get('name') or r.get('url', '').rsplit('/', 1)[-1], r.get('url', '')) for r in res
                    if re.search(pattern, (r.get('name') or '') + ' ' + r.get('url', ''), re.I)), key=lambda x: x[0])
    return (cands[-1][1], cands[-1][0]) if cands else None


def bcn_recurring(lines: Any, min_days: int = 2, max_share: float = 0.3, max_span_h: float = 4.0) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Barcelona fines (one CSV row each; codes 1210-1221 are speeding). A place is a recurring mobile
    spot when its fines come on few days of the period (2 or more, at most 30 %), in sessions of a few
    hours (median at most 4 h) with several fines each. A place fining on most days or all day long
    is a fixed camera and is left out. Places are the published street address (portal or road PK)."""
    by: dict[tuple[str, str], dict[str, list[int]]] = {}
    info: dict[tuple[str, str], tuple[str, float, float]] = {}
    days: set[str] = set()
    for r in csv.DictReader(lines):
        day = (r.get('Data_Infraccio') or '').strip()
        if day:
            days.add(day)
        try:
            code = int((r.get('Infraccio_Codi') or '').strip())
        except ValueError:
            continue
        hour = (r.get('Hora_Infraccio') or '').strip()
        if not 1210 <= code <= 1221 or not re.fullmatch(r'\d{3,6}', hour):
            continue
        try:
            lon, lat = float(r['Longitud_WGS84']), float(r['Latitud_WGS84'])
        except (KeyError, ValueError):
            continue
        hour = hour.zfill(6)
        k = (r.get('Codi_Carrer', '').strip(), (r.get('Num_Carrer') or '').strip().lstrip('0'))
        by.setdefault(k, {}).setdefault(day, []).append(int(hour[:2]) * 60 + int(hour[2:4]))
        info[k] = ((r.get('Nom_Carrer') or '').strip(), lon, lat)
    period = sorted(days)
    out = []
    for k, d in by.items():
        nd = len(d)
        fines = sum(len(v) for v in d.values())
        spans = [(max(v) - min(v)) / 60 for v in d.values()]
        if nd < min_days or nd > max_share * max(len(period), 1) or statistics.median(spans) > max_span_h or fines < 3 * nd:
            continue
        hours = sorted({m // 60 for v in d.values() for m in v})
        name, lon, lat = info[k]
        out.append({'street': name, 'num': k[1], 'lon': lon, 'lat': lat, 'days': nd, 'fines': fines,
                    'span_h': round(statistics.median(spans), 1), 'hours': hours, 'last_day': max(d)})
    return out, {'from': period[0] if period else '', 'to': period[-1] if period else '', 'places': len(by)}


MADRID_PLACE = re.compile(r'^(?:[A-Z]{1,2}\d{2,3}|KM\s+\S+|\d+,\d+)\s+')


def madrid_street(lugar: str) -> str:
    """'N034 ALFONSO XII' -> 'Alfonso Xii'; 'KM M3,, AV AMERICA' -> 'Avenida America'; '01,3 M-23 HACIA M30' -> 'M-23'."""
    s = MADRID_PLACE.sub('', lugar.strip()).strip(' ,')
    s = re.split(r'\s+(?:HACIA|SENTIDO|CON|ESQ)\s+', s)[0]
    road = re.match(r'^(M-?\d+|A-?\d+)$', s)
    return road.group(1) if road else expand(s)


def madrid_recurring(lines: Any, max_hours: int = 4) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Madrid fines (month and hour only, no day): speeding fines of 'MOVILIDAD RADAR' (the city's
    mobile radars) grouped by place; a place fined at few different hours (at most 4) is a mobile spot,
    one fined around the clock is a fixed camera."""
    reader = csv.reader(lines, delimiter=';')
    head = [h.strip().upper() for h in next(reader)]
    ix = {h: i for i, h in enumerate(head)}
    need = ('LUGAR', 'HORA', 'DENUNCIANTE', 'VEL_CIRCULA', 'MES', 'ANIO')
    if any(n not in ix for n in need):
        raise ValueError(f'columnas inesperadas: {head}')
    by: dict[str, list[str]] = {}
    month = ''
    for row in reader:
        row = [c.replace('\x00', '').strip() for c in row]
        if len(row) <= max(ix[n] for n in need):
            continue
        if row[ix['DENUNCIANTE']] != 'MOVILIDAD RADAR' or not row[ix['VEL_CIRCULA']]:
            continue
        month = month or f"{row[ix['ANIO']]}-{row[ix['MES']].zfill(2)}"
        by.setdefault(row[ix['LUGAR']], []).append(row[ix['HORA']][:2])
    out = []
    for lugar, hours in by.items():
        hs = sorted(set(hours))
        if len(hours) < 3 or len(hs) > max_hours:
            continue
        out.append({'place': lugar, 'street': madrid_street(lugar), 'fines': len(hours), 'hours': [int(h) for h in hs if h.isdigit()]})
    return out, {'month': month, 'places': len(by)}


def text_lines(data: bytes, encoding: str) -> io.StringIO:
    return io.StringIO(data.decode(encoding, 'replace').replace('\x00', ''))
