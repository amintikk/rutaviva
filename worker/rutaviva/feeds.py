"""Turn each open-data publication into the compact records the map uses.

Every function takes the raw bytes of one publication and returns plain dicts, so it can be
tested with saved real files (tests/fixtures) without network access.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from .datex import (XSI_TYPE, all_values, clean, coords, descriptor, first, iter_local, local, parse, text,
                    texts, to_float, xsi_type)

Rec = dict[str, Any]

# ---------------------------------------------------------------- incidents

# Order matters: the first matching category wins. Keys are whole DATEX enum values (lower case) or
# whole Spanish words of the free-text comments, never substrings ("ice" is inside "service").
_CATS: list[tuple[str, frozenset[str]]] = [
    ('nieve', frozenset('snow ice blackice snowfall heavysnowfall snowdrifts freezingrain frost blizzard slush '
                        'snowchainsmandatory snowtyresmandatory snowchainsortyresmandatory winterequipmentmandatory '
                        'icyroad snowonroad packedsnow freezingofwetroads wetandicyroad nieve nevada cadenas hielo '
                        'placas'.split())),
    ('accidente', frozenset('accident accidents collision multivehicleaccident overturnedvehicle jackknifedtrailer '
                            'vehicleonfire accidente accidentes'.split())),
    ('cerrada', frozenset('roadclosed carriagewayclosures allcarriagewaysclosed cortada cortado corte'.split())),
    ('retencion', frozenset('abnormaltraffic congestion slowtraffic queuingtraffic stationarytraffic heavytraffic '
                            'stopandgo trafficcongestion retencion retención retenciones'.split())),
    ('meteo', frozenset('poorenvironment poorenvironmentconditions weatherrelatedroadconditions rain heavyrain fog denseFog '
                        'strongwinds crosswinds flooding visibilityreduced hail storm smokehazard sandstorms '
                        'extremeheat lluvia niebla viento'.lower().split())),
    ('obstaculo', frozenset('obstruction generalobstruction vehicleobstruction environmentalobstruction '
                            'infrastructuredamageobstruction animalpresenceobstruction objectontheroad '
                            'obstructionontheroad animalsontheroad brokendownvehicle spillageontheroad landslips '
                            'rockfalls mudslide fallentrees debris obstaculo obstáculo'.split())),
    ('obras', frozenset('roadmaintenance roadworks maintenanceworks constructionworks resurfacingwork maintenancework '
                        'roadmarkingwork newroadworkslayout obras'.split())),
    ('evento', frozenset('activities sportsevent march procession parade demonstration publicevent prueba deportiva'
                         .split())),
]

_TOKEN = re.compile(r'[^\W\d_]+')


def classify(rec_text: str) -> str:
    tokens = {t.lower() for t in _TOKEN.findall(rec_text)}
    for cat, keys in _CATS:
        if tokens & keys:
            return cat
    return 'otro'


# DATEX enum values worth showing in the detail sheet (translated in the browser).
_KEEP = re.compile(
    r'^(roadClosed|carriagewayClosures|laneClosures|singleAlternateLineTraffic|narrowLanes|lanesDeviated|newRoadworksLayout|'
    r'contraflow|useOfSpecifiedLanesOrCarriagewaysAllowed|roadworks|accident|slowTraffic|stationaryTraffic|queuingTraffic|'
    r'heavyTraffic|rain|snowfall|heavySnowfall|snowDrifts|ice|blackIce|freezingRain|fog|denseFog|strongWinds|flooding|'
    r'objectOnTheRoad|obstructionOnTheRoad|animalsOnTheRoad|brokenDownVehicle|vehicleOnFire|slipperyRoad|'
    r'roadSurfaceInPoorCondition|snowChainsMandatory|snowTyresMandatory|snowChainsOrTyresMandatory|winterEquipmentMandatory|'
    r'heavyVehicle|carOrLightVehicle|motorcycle|anyVehicle|mandatory|advisory|bothWays|positive|negative|'
    r'allLanesCompleteCarriageway|hardShoulder|leftLane|rightLane|centralLane|lane1|lane2|lane3|lane4|'
    r'roadClearance|roadMarkingWork|resurfacingWork|maintenanceWork|sportsEvent|march|procession|emergencyVehicles|'
    r'landslips|rockfalls|fire|smokeHazard|crosswinds|visibilityReduced|hazardsOnTheRoad|spillageOnTheRoad|'
    r'temporaryTrafficLights|trafficControl|trafficHeld|convoyService|rollingRoadBlock)$')


def _num(s: str) -> float | None:
    v = to_float(s)
    return None if v is None or math.isnan(v) else v


def incidents(data: bytes, src: str) -> list[Rec]:
    root = parse(data)
    out: list[Rec] = []
    for r in iter_local(root, 'situationRecord'):
        kind = xsi_type(r)
        values = all_values(r)
        pts = coords(r)
        if not pts:
            continue
        status = text(r, 'validityStatus')
        if status in ('suspended', 'inactive'):
            continue
        cat = classify(f'{kind} {values}')
        if cat == 'otro' and 'allLanesCompleteCarriageway' in values and 'mandatory' in values:
            cat = 'cerrada'  # a bare lane-management record over the whole carriageway is a cut
        # A full closure for roadworks is shown as a closure, not as roadworks.
        what = sorted({t for t in values.split() if _KEEP.match(t)})
        road = text(r, 'roadName') or text(r, 'roadNumber') or descriptor(r, 'linkName')
        kms = [k for k in (_num(t) for t in texts(r, 'kilometerPoint')) if k is not None]
        if not kms:
            dist = [d for d in (_num(t) for t in texts(r, 'referencePointDistance')) if d is not None]
            kms = [round(d / 1000, 1) for d in dist]
        comments = [clean(c) for c in texts(r, 'value') if len(c) > 12 and not re.match(r'^-?\d', c)]
        sev = text(r, 'severity') or text(r, 'overallSeverity')
        rec: Rec = {
            'id': f'{src}:{r.get("id", "")}',
            'src': src,
            'cat': cat,
            'road': clean(road.replace(' - ', '-')),
            'km': kms[0] if kms else None,
            'km2': kms[-1] if len(kms) > 1 and kms[-1] != kms[0] else None,
            'dir': text(r, 'tpegDirection') or text(r, 'directionRelative'),
            'prov': text(r, 'province'),
            'muni': text(r, 'municipality') or descriptor(r, 'townName'),
            'start': text(r, 'overallStartTime'),
            'end': text(r, 'overallEndTime'),
            'sev': sev,
            'what': what,
            'txt': ' · '.join(dict.fromkeys(c for c in comments if c.upper() != road.upper()))[:400],
            # DATEX lists the "to" point before the "from" point; keep [from, to].
            'pts': [pts[1], pts[0]] if len(pts) >= 2 and pts[1] != pts[0] else [pts[0]],
        }
        out.append(rec)
    # The same situation can be published as several records at the same point: keep one per id.
    seen: dict[str, Rec] = {}
    for rec in out:
        seen.setdefault(rec['id'], rec)
    return list(seen.values())


# ---------------------------------------------------------------- devices (cameras, VMS)

def _device_point(d) -> tuple[float, float] | None:
    pts = coords(d)
    return pts[0] if pts else None


def cameras(data: bytes) -> list[Rec]:
    out = []
    for d in iter_local(parse(data), 'device'):
        if text(d, 'typeOfDevice') not in ('camera', ''):
            continue
        p = _device_point(d)
        url = text(d, 'deviceUrl')
        if not p or not url:
            continue
        out.append({
            'id': d.get('id', ''),
            'lon': p[0], 'lat': p[1],
            'road': clean(text(d, 'roadName').replace(' - ', '-')),
            'km': _num(text(d, 'kilometerPoint')),
            'prov': text(d, 'province'),
            'dest': text(d, 'roadDestination').title(),
            'img': url,
        })
    return out


def vms(status: bytes, locations: bytes) -> list[Rec]:
    loc: dict[str, Rec] = {}
    for d in iter_local(parse(locations), 'device'):
        p = _device_point(d)
        if p:
            loc[d.get('id', '')] = {
                'lon': p[0], 'lat': p[1], 'road': clean(text(d, 'roadName').replace(' - ', '-')),
                'km': _num(text(d, 'kilometerPoint')), 'prov': text(d, 'province'),
                'dest': text(d, 'roadDestination').title()}
    out = []
    for c in iter_local(parse(status), 'vmsControllerStatus'):
        ref = first(c, 'vmsControllerReference')
        cid = ref.get('id', '') if ref is not None else ''
        where = loc.get(cid)
        if not where:
            continue
        lines: list[str] = []
        picts: list[str] = []
        when = ''
        for m in iter_local(c, 'vmsMessage'):
            when = when or text(m, 'timeLastSet')
            for tl in iter_local(m, 'textLine'):
                if any(local(ch.tag) == 'textLine' for ch in tl):
                    continue  # only the innermost <textLine> holds the text
                t = clean(tl.text or '')
                if t and not re.fullmatch(r'(@\w+\s*)+', t) and t not in lines:  # "@H @F" = clock/thermometer
                    lines.append(t)
            for code in texts(m, 'customPictogramCode'):
                if code not in picts:
                    picts.append(code)
        out.append({'id': cid, **where, 'lines': lines, 'picts': picts, 'set': when})
    return out


# ---------------------------------------------------------------- radars and enforcement stretches

def predefined(data: bytes) -> list[Rec]:
    """Generic predefined locations (v1.0 radars / INVIVE, v3 motorcycle risk stretches).

    Only the outermost location elements count (v1.0 nests a predefinedLocation inside another)."""
    out: list[Rec] = []
    kinds = ('predefinedLocation', 'predefinedLocationReference')

    def walk(el, set_name: str) -> None:
        for ch in el:
            name = local(ch.tag)
            if name == 'predefinedLocationSet':
                sn = first(ch, 'predefinedLocationSetName')
                walk(ch, clean(''.join(sn.itertext())) if sn is not None else '')
            elif name in kinds:
                rec = _location(ch, set_name)
                if rec:
                    out.append(rec)
            else:
                walk(ch, set_name)

    walk(parse(data), '')
    return out


def _location(loc, set_name: str) -> Rec | None:
    pts = coords(loc)
    if not pts:
        return None
    road = text(loc, 'roadNumber') or text(loc, 'roadName') or descriptor(loc, 'linkName')
    if not road:
        for d in iter_local(loc, 'ilc'):
            road = text(d, 'value')
            if road:
                break
    dist = [d for d in (_num(t) for t in texts(loc, 'referencePointDistance')) if d is not None]
    kms = [k for k in (_num(t) for t in texts(loc, 'kilometerPoint')) if k is not None] or \
        [round(d / 1000, 1) for d in dist]
    if not kms and '_' in loc.get('id', ''):  # v3 ids look like "Las Palmas_GC-240_1500.0" (metres)
        k = _num(loc.get('id', '').rsplit('_', 1)[-1])
        if k is not None:
            length = _num(text(loc, 'lengthAffected')) or 0
            kms = [round(k / 1000, 1), round((k + length) / 1000, 1)]
    nm = first(loc, 'predefinedLocationName')
    prov = descriptor(loc, 'other') or text(loc, 'province')
    if not prov:
        for o in iter_local(loc, 'otherName'):
            if text(o, 'tpegOtherPointDescriptorType') == 'administrativeAreaName':
                prov = text(o, 'value')
                break
    if len(pts) > 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    # v3 lists "to" before "from".
    if first(loc, 'to') is not None and first(loc, 'from') is not None and len(pts) == 2:
        to_el = first(loc, 'to')
        to_pts = coords(to_el) if to_el is not None else []
        if to_pts and to_pts[0] == pts[0]:
            pts = [pts[1], pts[0]]
    return {
        'set': set_name, 'id': loc.get('id', ''), 'name': clean(''.join(nm.itertext())) if nm is not None else '',
        'road': clean(road.replace(' - ', '-')),
        'km': kms[0] if kms else None, 'km2': kms[-1] if len(kms) > 1 else None,
        'prov': prov, 'dir': text(loc, 'directionRelative') or text(loc, 'tpegDirection'), 'pts': pts,
    }


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def radars(data: bytes) -> list[Rec]:
    out = []
    for p in predefined(data):
        tramo = 'VelocidadMedia' in p['set'] or len(p['pts']) > 1
        rec = {'id': p['id'], 'kind': 'tramo' if tramo else 'fijo', 'road': p['road'], 'km': p['km'],
               'prov': p['prov'].title() if p['prov'].isupper() else p['prov'], 'dir': p['dir'],
               'lon': p['pts'][0][0], 'lat': p['pts'][0][1]}
        if tramo:
            a, b = p['pts'][0], p['pts'][-1]
            rec['line'] = [a, b]
            rec['km2'] = p['km2']
            rec['len'] = round(abs((p['km2'] or 0) - (p['km'] or 0)), 1) if p['km'] is not None and p['km2'] is not None \
                else round(_haversine(a, b), 1)
        out.append(rec)
    return out


def stretches(data: bytes) -> list[Rec]:
    out = []
    for p in predefined(data):
        out.append({'id': p['id'], 'road': p['road'], 'km': p['km'], 'km2': p['km2'], 'name': p['name'],
                    'prov': p['prov'].title() if p['prov'].isupper() else p['prov'], 'line': p['pts']})
    return out


# ---------------------------------------------------------------- low-emission zones

def _simplify(pts: list[tuple[float, float]], tol: float = 0.00004) -> list[tuple[float, float]]:
    """Douglas-Peucker (~4 m): ZBE polygons come with a point every metre."""
    if len(pts) > 3 and pts[0] == pts[-1]:
        pts = pts[:-1]  # closed ring: the closing point is added back by the caller
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / n if (dx or dy) else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, k
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


ORDER = ['A', 'B', 'C', 'ECO', '0']


def banned_badges(listed: list[str]) -> list[str] | None:
    """The DGT files list environmental badges in a sticker condition whose meaning varies between
    cities: some list the banned badges (Madrid: "Sin distintivo"), others the allowed ones (Alcalá:
    B, C, ECO, 0). A list with "A" is read as banned; one without it as allowed (so the rest are
    banned); a list with all five says nothing usable (None: check the city's conditions)."""
    s = set(listed)
    if not s or s == set(ORDER):
        return None
    if 'A' in s:
        return [b for b in ORDER if b in s]
    return [b for b in ORDER if b not in s]


_BADGES = {'sin distintivo': 'A', 'a': 'A', 'b': 'B', 'c': 'C', 'eco': 'ECO', '0': '0', 'cero': '0'}


def zbe(data: bytes, city: str) -> list[Rec]:
    out = []
    for z in iter_local(parse(data), 'controlledZone'):
        polys = []
        for g in iter_local(z, 'locationContainedInGroup'):
            pts = coords(g)
            if len(pts) >= 3:
                polys.append([list(p) for p in _simplify(pts)])
        if not polys:
            continue
        badges: list[str] = []
        periods: list[str] = []
        for cond in iter_local(z, 'conditions'):
            if text(cond, 'type') == 'stickerCondition':
                for v in texts(cond, 'value'):
                    b = _BADGES.get(v.strip().lower())
                    if b and b not in badges:
                        badges.append(b)
        for vp in iter_local(z, 'validPeriod'):
            name = text(vp, 'value')
            a, b = text(vp, 'startTimeOfPeriod')[:5], text(vp, 'endTimeOfPeriod')[:5]
            label = {'L': 'Laborables', 'F': 'Festivos', 'S': 'Sábados', 'D': 'Domingos'}.get(name, name)
            span = 'todo el día' if (a, b) in (('00:00', '23:59'), ('', '')) else f'{a}–{b}'
            p = f'{label}: {span}' if label else span
            if p not in periods:
                periods.append(p)
        name = ''
        n = first(z, 'name')
        if n is not None:
            name = clean(' '.join(n.itertext()))
        out.append({
            'id': z.get('id', ''), 'city': city, 'name': name, 'url': text(z, 'urlForFurtherInformation'),
            'status': text(z, 'status'), 'since': text(z, 'overallStartTime')[:10],
            'banned': banned_badges(badges), 'listed': sorted(badges, key=ORDER.index), 'periods': periods, 'polys': polys,
        })
    return out


# ---------------------------------------------------------------- EV charging (static, MITERD via NAP)

_CONN = {'iec62196T2COMBO': 'CCS', 'chademo': 'CHAdeMO', 'iec62196T2': 'Tipo 2', 'domesticF': 'Schuko',
         'iec62196T1': 'Tipo 1', 'iec62196T1COMBO': 'CCS1', 'teslaConnector': 'Tesla', 'teslaR': 'Tesla',
         'teslaS': 'Tesla', 'iec60309x2single16': 'CEE', 'iec60309x2three16': 'CEE', 'iec60309x2three32': 'CEE',
         'domesticE': 'Schuko'}


def charging(data: bytes) -> list[Rec]:
    out = []
    for s in iter_local(parse(data), 'energyInfrastructureSite'):
        p = coords(s)
        if not p:
            continue
        addr: dict[str, str] = {}
        for line in iter_local(s, 'addressLine'):
            v = text(line, 'value')
            if ':' in v:
                k, _, val = v.partition(':')
                addr[k.strip().lower()] = val.strip()
        op = first(s, 'operator')
        kw = 0.0
        conns: dict[str, int] = {}
        points = 0
        for rp in iter_local(s, 'refillPoint'):
            points += 1
            for c in iter_local(rp, 'connector'):
                t = _CONN.get(text(c, 'connectorType'), 'Otro')
                conns[t] = conns.get(t, 0) + 1
                w = to_float(text(c, 'maxPowerAtSocket')) or 0
                kw = max(kw, w / 1000)
        name_el = first(s, 'name')
        out.append({
            'id': s.get('id', ''), 'lon': p[0][0], 'lat': p[0][1],
            'name': clean(' '.join(name_el.itertext())) if name_el is not None else '',
            'op': clean(' '.join(first(op, 'name').itertext())) if op is not None and first(op, 'name') is not None else '',
            'addr': addr.get('dirección', ''), 'muni': addr.get('municipio', ''), 'prov': addr.get('provincia', ''),
            'hours': clean(text(s, 'label')), 'points': points, 'kw': round(kw, 1), 'conns': conns,
            'updated': text(s, 'lastUpdated')[:10],
        })
    return out


# ---------------------------------------------------------------- fuel stations (MITECO)

FUELS = {  # MITECO field -> short code used everywhere else
    'Precio Gasolina 95 E5': 'g95', 'Precio Gasolina 95 E10': 'g95e10', 'Precio Gasolina 95 E5 Premium': 'g95p',
    'Precio Gasolina 98 E5': 'g98', 'Precio Gasolina 98 E10': 'g98e10', 'Precio Gasoleo A': 'diesel',
    'Precio Gasoleo Premium': 'dieselp', 'Precio Gasoleo B': 'dieselb', 'Precio Gases licuados del petróleo': 'glp',
    'Precio Gas Natural Comprimido': 'gnc', 'Precio Gas Natural Licuado': 'gnl', 'Precio Hidrogeno': 'h2',
    'Precio Adblue': 'adblue', 'Precio Diésel Renovable': 'hvo', 'Precio Gasolina Renovable': 'grenov',
    'Precio Bioetanol': 'e85', 'Precio Gasolina 95 E85': 'e85', 'Precio Biodiesel': 'biodiesel',
    # Old names used in the historical files.
    'Precio Gasolina 95 Protección': 'g95', 'Precio Gasolina  98': 'g98', 'Precio Gasolina 98': 'g98',
    'Precio Gasoleo A habitual': 'diesel', 'Precio Nuevo Gasoleo A': 'dieselp', 'Precio Gas Natural Licuado ': 'gnl',
}
FUEL_CODES = sorted(set(FUELS.values()))


def _title(s: str) -> str:
    if s != s.upper():
        return s.strip()
    t = s.lower().title()
    return re.sub(r'\b(De|Del|La|Las|Los|El|Y|En|A)\b', lambda m: m.group(0).lower(), t).strip()


def fuel(data: bytes) -> tuple[str, list[Rec]]:
    """Returns (MITECO timestamp, stations)."""
    d = json.loads(data)
    out = []
    for e in d.get('ListaEESSPrecio', []):
        lon, lat = to_float(e.get('Longitud (WGS84)', '')), to_float(e.get('Latitud', ''))
        if lon is None or lat is None or (lon == 0 and lat == 0):
            continue
        prices: dict[str, float] = {}
        for k, code in FUELS.items():
            v = to_float(e.get(k) or '')
            if v and 0.2 < v < 5 and code not in prices:
                prices[code] = round(v, 3)
        if not prices:
            continue
        out.append({
            'id': e.get('IDEESS', ''), 'lon': round(lon, 6), 'lat': round(lat, 6),
            'brand': _title(e.get('Rótulo', '')), 'addr': _title(e.get('Dirección', '')),
            'muni': _title(e.get('Municipio', '')), 'prov': _title(e.get('Provincia', '')),
            'prov_id': e.get('IDProvincia', ''), 'cp': e.get('C.P.', ''), 'hours': e.get('Horario', ''),
            'side': e.get('Margen', ''), 'public': e.get('Tipo Venta', '') == 'P', 'p': prices,
        })
    return d.get('Fecha', ''), out


# ---------------------------------------------------------------- earthquakes (IGN GeoRSS)

def quakes(data: bytes) -> list[Rec]:
    root = parse(data)
    out = []
    for it in iter_local(root, 'item'):
        title = text(it, 'title')
        desc = text(it, 'description')
        lat, lon = to_float(text(it, 'lat')), to_float(text(it, 'long'))
        if lat is None or lon is None:
            pt = text(it, 'point').split()
            if len(pt) == 2:
                lat, lon = to_float(pt[0]), to_float(pt[1])
        if lat is None or lon is None:
            continue
        m = re.search(r'magnitud\s+([\d.,]+)', f'{title} {desc}', re.I)
        when = re.search(r'(\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}:\d{2})', f'{title} {desc}')
        place = re.search(r'en\s+(.+?)\s+en la fecha', desc) or re.search(r'\d\s+(.+)$', title)
        out.append({'id': text(it, 'link').rsplit('=', 1)[-1] or title, 'lon': lon, 'lat': lat,
                    'mag': to_float(m.group(1)) if m else None, 'when': when.group(1) if when else '',
                    'place': clean(place.group(1)) if place else '', 'url': text(it, 'link')})
    return out


__all__ = ['incidents', 'cameras', 'vms', 'radars', 'stretches', 'zbe', 'charging', 'fuel', 'quakes', 'classify',
           'FUELS', 'FUEL_CODES', 'XSI_TYPE']
