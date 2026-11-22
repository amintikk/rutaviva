"""Ruta viva worker: polls every open-data source on its own schedule, writes the live layers
(/data/live/*.json, served by nginx), keeps the archives and answers the small /api/ endpoints."""
from __future__ import annotations

import asyncio
import json
import math
import datetime as dt
import logging
import os
import re
import sqlite3
import time
import traceback
from collections import Counter
from typing import Awaitable, Callable

import aiohttp
from aiohttp import web

from . import feeds as F
from . import fuelhist as H
from . import dgt_radares as DR
from . import enforcement as E
from . import osm as O
from . import traffic as TR
from .pk import PkIndex
from .reve import Reve, ranking, summarize, sweep
from .store import DATA as DATA_DIR, Meta, collection, db, feature, now_iso, read_json as read_live, write_json

log = logging.getLogger('rutaviva')
NAP = 'https://nap.dgt.es'
MITECO = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'
UA = 'RutaViva/1.0 (+https://rutaviva.aminox.dev/fuentes/)'
URLS = {
    'dgt_inc': f'{NAP}/datex2/v3/dgt/SituationPublication/datex2_v37.xml',
    'sct_inc': f'{NAP}/datex2/sct/SituationPublication/all/content.xml',
    'gv_inc': f'{NAP}/datex2/dt-gv/SituationPublication/all/content.xml',
    'cams': f'{NAP}/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml',
    'vms': f'{NAP}/datex2/v3/dgt/VmsPublication/datex2_v37.xml',
    'vms_loc': f'{NAP}/datex2/v3/dgt/DevicePublication/vms_datex2_v37.xml',
    'radars': f'{NAP}/datex2/dgt/PredefinedLocationsPublication/radares/content.xml',
    'invive': f'{NAP}/datex2/dgt/PredefinedLocationsPublication/tramos_invive/content.xml',
    'motos': f'{NAP}/datex2/dgt/PredefinedLocationsPublication/tramosriesgomotos/content.xml',
    'zbe_index': f'{NAP}/datex2/v3/dgt/zbe/ControledZonePublication/',
    'ev': f'{NAP}/datex2/v3/miterd/EnergyInfrastructureTablePublication/electrolineras.xml',
    'fuel': f'{MITECO}/EstacionesTerrestres/',
    'fuel_hist': f'{MITECO}/EstacionesTerrestresHist/',
    'quakes': 'https://www.ign.es/ign/RssTools/sismologia.xml',
}


# City names for the DGT's ZBE file names (which drop accents and spaces).
CITY = {
    'AlcalaDeHenares': 'Alcalá de Henares', 'Avila': 'Ávila', 'Castellon': 'Castelló de la Plana', 'CerdanyolaDelValles': 'Cerdanyola del Vallès',
    'Donostia-SanSebastian': 'Donostia / San Sebastián', 'DosHermanas': 'Dos Hermanas', 'ElPratDeLlobregat': 'El Prat de Llobregat',
    'Gava': 'Gavà', 'LasRozas': 'Las Rozas', 'Malaga': 'Málaga', 'Mataro': 'Mataró', 'MolinaDeSegura': 'Molina de Segura',
    'PamplonaEnsanche': 'Pamplona', 'RondasDeBarcelona': 'Rondas de Barcelona', 'Rubi': 'Rubí', 'SantBoiDeLlobregat': 'Sant Boi de Llobregat',
    'SantCugatDelValles': 'Sant Cugat del Vallès', 'SantJoanDespi': 'Sant Joan Despí', 'SevillaCartuja': 'Sevilla',
    'Terrasa': 'Terrassa', 'VitoriaGasteiz': 'Vitoria-Gasteiz', 'Valencia': 'València',
}


class Worker:
    def __init__(self) -> None:
        self.meta = Meta()
        self.con = db()
        H.ensure_tables(self.con)
        self.session: aiohttp.ClientSession | None = None
        self.reve: Reve | None = None
        self.backfill_enabled = os.environ.get('RUTAVIVA_BACKFILL', '1') == '1'

    # ------------------------------------------------------------ http

    async def get(self, url: str, *, accept: str = '*/*', timeout: float = 90, tries: int = 3) -> bytes:
        assert self.session
        err: Exception | None = None
        for i in range(tries):
            try:
                async with self.session.get(url, headers={'Accept': accept, 'User-Agent': UA},
                                            timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                    if r.status != 200:
                        raise RuntimeError(f'HTTP {r.status} {url}')
                    return await r.read()
            except Exception as e:  # noqa: BLE001 - retried, then reported in meta.json
                err = e
                await asyncio.sleep(3 * (i + 1))
        raise RuntimeError(f'{url}: {err}')

    # ------------------------------------------------------------ feeds

    async def incidents(self) -> None:
        results = await asyncio.gather(self.get(URLS['dgt_inc']), self.get(URLS['sct_inc']), self.get(URLS['gv_inc']),
                                       return_exceptions=True)
        recs: list[dict] = []
        errors = []
        for (src, label), res in zip((('dgt', 'DGT'), ('sct', 'SCT'), ('gv', 'Euskadi')), results):
            if isinstance(res, BaseException):
                errors.append(f'{label}: {res}')
                continue
            try:
                recs += F.incidents(res, src)
            except Exception as e:  # noqa: BLE001
                errors.append(f'{label}: {e}')
        if not recs and errors:
            raise RuntimeError('; '.join(errors))
        points, lines = [], []
        snapped = await self.snap_lines(recs)
        for r in recs:
            a = r['pts'][0]
            props = {k: v for k, v in r.items() if k not in ('pts',) and v not in (None, '', [])}
            props['what'] = ','.join(r['what'])
            try:
                started = dt.datetime.fromisoformat(r['start'])
                props['days'] = max(0, (dt.datetime.now(dt.UTC) - started).days)
            except (ValueError, TypeError):
                pass
            points.append(feature(a[0], a[1], props))
            geom = snapped.get(r['id'])
            if geom:
                lines.append(feature(0, 0, {'id': r['id'], 'cat': r['cat']}, {'type': 'LineString', 'coordinates': geom}))
        write_json('incidents', collection(points, generated=now_iso(), errors=errors))
        write_json('incident-lines', collection(lines))
        now = now_iso()
        self.con.executemany('''INSERT INTO incident (id, src, cat, road, km, prov, muni, lon, lat, start, first_seen, last_seen, what)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen, cat=excluded.cat''',
                             [(r['id'], r['src'], r['cat'], r['road'], r['km'], r['prov'], r['muni'], r['pts'][0][0],
                               r['pts'][0][1], r['start'], now, now, ','.join(r['what'])) for r in recs])
        self.con.commit()
        self.meta.ok('incidents', len(recs), '; '.join(errors))

    async def _route(self, a: tuple[float, float], b: tuple[float, float], radius: int,
                     shortest: bool = False) -> tuple[float, list] | None:
        body = {'locations': [{'lat': a[1], 'lon': a[0], 'radius': radius}, {'lat': b[1], 'lon': b[0], 'radius': radius}],
                'costing': 'auto', 'costing_options': {'auto': {'shortest': shortest}}, 'directions_type': 'none'}
        assert self.session
        async with self.session.post('http://rutaviva-valhalla:8002/route', json=body,
                                     timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status >= 500:
                raise RuntimeError(f'valhalla {resp.status}')
            if resp.status != 200:
                return None
            j = await resp.json()
            return j['trip']['summary']['length'], decode6(j['trip']['legs'][0]['shape'])

    async def snap(self, items: list[tuple[str, list[tuple[float, float]], float | None]], budget: int = 200,
                   keep_short: float = 1.5) -> dict[str, list[list[float]]]:
        """Follow the road between the first and last point of each item with Valhalla, so a stretch
        is drawn along the carriageway, not as a straight line. Both directions are tried (a one-way
        carriageway can force a detour in one of them) and the result must match the length the
        source declares (km to km) or, without it, not be a big detour. Cached per id and position.
        When no route is plausible, stretches shorter than `keep_short` km keep the straight segment
        and longer ones get no line at all (a straight line across the country would be misleading)."""
        self.con.execute('CREATE TABLE IF NOT EXISTS incident_geom (id TEXT, key TEXT, geom TEXT, PRIMARY KEY (id, key))')
        out: dict[str, list[list[float]]] = {}
        for item_id, pts, expected in items:
            if len(pts) < 2:
                continue
            (x1, y1), (x2, y2) = pts[0], pts[-1]
            straight = math.hypot((x2 - x1) * 85, (y2 - y1) * 111)  # km, good enough at Spanish latitudes
            if straight < 0.05 or straight > 150:
                continue
            key = f'v3|{x1:.5f},{y1:.5f},{x2:.5f},{y2:.5f}'
            row = self.con.execute('SELECT geom FROM incident_geom WHERE id=? AND key=?', (item_id, key)).fetchone()
            if row:
                if row[0]:
                    out[item_id] = json.loads(row[0])
                continue
            if budget <= 0:
                continue
            budget -= 1

            def plausible(length: float) -> bool:
                if expected and expected > 0.3:
                    return expected * 0.7 - 1 <= length <= expected * 1.35 + 2
                return length <= straight * 1.8 + 1.5

            geom = None
            try:
                best = None
                # The fastest route often leaves the road (a faster motorway nearby); the shortest one
                # follows the road itself, which is what a stretch "from km X to km Y" means.
                for radius, shortest in ((60, False), (60, True), (250, True)):
                    for a, b in (((x1, y1), (x2, y2)), ((x2, y2), (x1, y1))):
                        r = await self._route(a, b, radius, shortest)
                        if r and plausible(r[0]) and (best is None or r[0] < best[0]):
                            best = r
                    if best:
                        break
                if best:
                    geom = [[round(c, 5) for c in p] for p in best[1]]
            except Exception:  # noqa: BLE001 - Valhalla busy or not ready: retry next round
                break
            if geom is None and straight < keep_short:
                geom = [list(pts[0]), list(pts[-1])]
            self.con.execute('INSERT OR REPLACE INTO incident_geom (id, key, geom) VALUES (?,?,?)',
                             (item_id, key, json.dumps(geom) if geom else ''))
            if geom:
                out[item_id] = geom
        self.con.commit()
        return out

    async def snap_lines(self, recs: list[dict]) -> dict[str, list[list[float]]]:
        return await self.snap([(r['id'], r['pts'], abs(r['km2'] - r['km']) if r.get('km') is not None and r.get('km2') is not None else None)
                                for r in recs if len(r['pts']) == 2])

    async def osm_data(self) -> dict:
        """Enforcement data and kilometre posts from OpenStreetMap, prepared by `python -m rutaviva.osm`
        (deploy.sh runs it in a separate container whenever the extract changes)."""
        cache = DATA_DIR / 'osm-enforcement.json'
        if not cache.exists():
            log.warning('osm-enforcement.json missing: run ./deploy.sh worker')
            return {}
        return await asyncio.to_thread(lambda: json.loads(cache.read_text()))

    async def dgt_lists(self) -> tuple[list[dict], list[dict]]:
        """The DGT's PDF lists of cameras (report + equipment); the last good copy is kept."""
        cache = DATA_DIR / 'dgt-radares.json'
        try:
            html = (await self.get(DR.PAGE, accept='text/html')).decode('utf-8', 'replace')
            links = DR.pdf_links(html)
            inf = DR.parse_informe(DR.pdf_text(await self.get(links['informe'], timeout=120)))
            eq = DR.parse_equipos(DR.pdf_text(await self.get(links['equipos'], timeout=120)))
            if len([r for r in inf if r['kind'] == 'fijo']) < 400:
                raise RuntimeError(f'informe con solo {len(inf)} filas')
            cache.write_text(json.dumps({'informe': inf, 'equipos': eq, 'links': links, 'at': now_iso()}))
            return inf, eq
        except Exception as e:  # noqa: BLE001 - fall back to the last list that worked
            log.warning('dgt lists: %s', e)
            if cache.exists():
                d = json.loads(cache.read_text())
                return d['informe'], d['equipos']
            raise

    async def city_traffic(self) -> None:
        results = await asyncio.gather(self.get(TR.MADRID), self.get(TR.BCN_STATE), self.bcn_sections(), return_exceptions=True)
        feats, notes = [], []
        if not isinstance(results[0], BaseException):
            stamp, pts = TR.madrid(results[0])
            feats += [feature(p['lon'], p['lat'], {k: v for k, v in p.items() if k not in ('lon', 'lat')} | {'city': 'Madrid'}) for p in pts]
            notes.append(f'Madrid {len(pts)} ({stamp})')
        else:
            notes.append(f'Madrid: {results[0]}')
        if not isinstance(results[1], BaseException) and not isinstance(results[2], BaseException):
            stamp, secs = TR.barcelona(results[2], results[1])
            feats += [feature(0, 0, {k: v for k, v in x.items() if k != 'line'} | {'city': 'Barcelona'},
                              {'type': 'LineString', 'coordinates': x['line']}) for x in secs]
            notes.append(f'Barcelona {len(secs)} ({stamp})')
        else:
            notes.append(f'Barcelona: {results[1] if isinstance(results[1], BaseException) else results[2]}')
        if not feats:
            raise RuntimeError('; '.join(notes))
        write_json('traffic', collection(feats, generated=now_iso()))
        self.meta.ok('traffic', len(feats), '; '.join(notes))

    async def bcn_sections(self) -> bytes:
        """Barcelona's section geometries change rarely: cached for a day."""
        cache = DATA_DIR / 'bcn-trams.csv'
        if cache.exists() and time.time() - cache.stat().st_mtime < 86400:
            return cache.read_bytes()
        data = await self.get(TR.BCN_SECTIONS)
        cache.write_bytes(data)
        return data

    async def vms(self) -> None:
        status, loc = await asyncio.gather(self.get(URLS['vms']), self.get(URLS['vms_loc']))
        panels = F.vms(status, loc)
        feats = [feature(p['lon'], p['lat'], {'id': p['id'], 'road': p['road'], 'km': p['km'], 'prov': p['prov'].title(),
                                               'dest': p['dest'], 'lines': '\n'.join(p['lines']), 'picts': ','.join(p['picts']),
                                               'set': p['set'], 'on': bool(p['lines'] or p['picts'])})
                 for p in panels]
        write_json('vms', collection(feats, generated=now_iso()))
        self.meta.ok('vms', sum(1 for p in panels if p['lines'] or p['picts']))

    async def cameras(self) -> None:
        cams = F.cameras(await self.get(URLS['cams']))
        feats = [feature(c['lon'], c['lat'], {'id': c['id'], 'road': c['road'], 'km': c['km'], 'prov': c['prov'].title(),
                                               'dest': c['dest']}) for c in cams
                 if re.match(r'^https://etraffic\.dgt\.es/camarasEtraffic/\d+\.jpg$', c['img'])
                 and c['img'].endswith(f"/{c['id']}.jpg")]
        write_json('cameras', collection(feats, generated=now_iso()))
        self.meta.ok('cameras', len(feats))

    async def radars(self) -> None:
        rad, inv, mot = await asyncio.gather(self.get(URLS['radars']), self.get(URLS['invive']), self.get(URLS['motos']))
        nap = F.radars(rad)
        osm = await self.osm_data()
        informe, equipos = await self.dgt_lists()
        stretches = {'invive': F.stretches(inv), 'motos': F.stretches(mot)}
        # Reference points "road + km -> position" to place the DGT lists.
        index = PkIndex()
        for k, d, lon, lat in osm.get('milestones', []):
            index.roads.setdefault(k, []).append((d, lon, lat))
        for r in nap:
            index.add(r['road'], r['km'], r['lon'], r['lat'])
        for name in ('cameras', 'vms'):
            for f in (read_live(name) or {}).get('features', []):
                p = f['properties']
                index.add(p.get('road', ''), p.get('km'), *f['geometry']['coordinates'])
        for road, km, lon, lat in self.con.execute("SELECT road, km, lon, lat FROM incident WHERE src='dgt' AND km IS NOT NULL"):
            index.add(road, km, lon, lat)
        for st in stretches.values():
            for x in st:
                if x['km'] is not None and len(x['line']) >= 2:
                    index.add(x['road'], x['km'], *x['line'][0])
                    if x['km2'] is not None:
                        index.add(x['road'], x['km2'], *x['line'][-1])
        index.finish()

        async def route(a, b):
            try:
                return await self._route(a, b, 80, shortest=True)
            except Exception:  # noqa: BLE001
                return None

        points, sections = await E.build(informe, equipos, nap, osm, index, route,
                                         lambda items: self.snap(items, budget=300, keep_short=99))
        pts = [feature(p['lon'], p['lat'], {k: v for k, v in p.items() if k not in ('lon', 'lat') and v not in (None, '')}) for p in points]
        secs = [feature(0, 0, {k: v for k, v in s.items() if k != 'lines' and v not in (None, '')},
                        {'type': 'MultiLineString', 'coordinates': s['lines']}) for s in sections]
        write_json('radars', collection(pts, generated=now_iso()))
        write_json('radar-sections', collection(secs))
        counts = Counter((p['src'], p['kind']) for p in points)
        approx = sum(1 for p in points if p.get('pos') == 'aproximada')
        self.meta.ok('radars', len(points), ', '.join(f'{k[0]} {k[1]}: {v}' for k, v in sorted(counts.items())) + f'; aproximadas: {approx}')
        for name, st in stretches.items():
            span = lambda x: abs(x['km2'] - x['km']) if x.get('km') is not None and x.get('km2') is not None else None  # noqa: E731
            snapped = await self.snap([(f"{name}:{x['id']}", x['line'], span(x)) for x in st if len(x['line']) == 2],
                                      budget=2000, keep_short=1.0)
            feats = []
            for x in st:
                props = {k: v for k, v in x.items() if k != 'line' and v not in (None, '')}
                geom = snapped.get(f"{name}:{x['id']}")
                if geom:
                    feats.append(feature(0, 0, props, {'type': 'LineString', 'coordinates': geom}))
                else:
                    # No reliable road geometry: mark where the stretch starts and ends instead of a straight line.
                    feats.append(feature(0, 0, {**props, 'ends': True},
                                         {'type': 'MultiPoint', 'coordinates': [list(x['line'][0]), list(x['line'][-1])]}))
            write_json(name, collection(feats))

    async def zbe(self) -> None:
        index = (await self.get(URLS['zbe_index'])).decode('utf-8', 'replace')
        files = sorted(set(re.findall(r'href="([A-Za-z0-9_.-]+\.xml)"', index)))
        zones: list[dict] = []
        for f in files:
            if f in ('a.xml', 'B1a.xml'):  # test files published by the DGT
                continue
            city = CITY.get(f[:-4]) or re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', f[:-4]).replace('-', ' / ')
            try:
                zones += F.zbe(await self.get(URLS['zbe_index'] + f), city)
            except Exception as e:  # noqa: BLE001 - one broken city must not hide the rest
                log.warning('zbe %s: %s', f, e)
            await asyncio.sleep(0.5)
        feats = []
        for z in zones:
            feats.append(feature(0, 0, {k: v for k, v in z.items() if k != 'polys'} | {
                'banned': ','.join(z['banned']) if z['banned'] is not None else '?', 'listed': ','.join(z['listed']), 'periods': ' · '.join(z['periods'])},
                {'type': 'MultiPolygon', 'coordinates': [[p + [p[0]]] for p in z['polys']]}))
        write_json('zbe', collection(feats, generated=now_iso()))
        self.meta.ok('zbe', len(feats))

    async def ev(self) -> None:
        sites = F.charging(await self.get(URLS['ev'], timeout=300))
        feats = [feature(s['lon'], s['lat'], {'id': s['id'], 'name': s['name'], 'op': s['op'], 'addr': s['addr'],
                                               'muni': s['muni'], 'prov': s['prov'], 'hours': s['hours'],
                                               'points': s['points'], 'kw': s['kw'],
                                               'conns': ','.join(f'{k}:{v}' for k, v in s['conns'].items()),
                                               'dc': any(k in s['conns'] for k in ('CCS', 'CHAdeMO', 'Tesla')) and s['kw'] >= 40})
                 for s in sites]
        write_json('ev', collection(feats, generated=now_iso()))
        self.meta.ok('ev', len(feats))

    async def fuel(self) -> None:
        stamp, stations = F.fuel(await self.get(URLS['fuel'], accept='application/json', timeout=120))
        if len(stations) < 5000:
            raise RuntimeError(f'only {len(stations)} stations')
        feats = [feature(s['lon'], s['lat'], {'id': s['id'], 'brand': s['brand'], 'addr': s['addr'], 'muni': s['muni'],
                                               'prov': s['prov'], 'cp': s['cp'], 'hours': s['hours'], 'side': s['side'],
                                               'public': s['public'], **{f'p_{k}': v for k, v in s['p'].items()}})
                 for s in stations]
        # Price percentiles per fuel so the map can colour cheap/expensive without recomputing.
        pct: dict[str, list[float]] = {}
        for code in ('g95', 'diesel', 'g98', 'glp', 'dieselp', 'gnc', 'h2', 'adblue'):
            vals = sorted(s['p'][code] for s in stations if code in s['p'] and s['public'])
            if len(vals) >= 20:
                pct[code] = [vals[int(len(vals) * q)] for q in (0.05, 0.25, 0.5, 0.75, 0.95)]
        write_json('fuel', collection(feats, generated=now_iso(), source_time=stamp, pct=pct))
        self.meta.ok('fuel', len(feats), stamp)

    async def quakes(self) -> None:
        q = F.quakes(await self.get(URLS['quakes']))
        write_json('quakes', collection([feature(x['lon'], x['lat'], {k: v for k, v in x.items() if k not in ('lon', 'lat')})
                                         for x in q], generated=now_iso()))
        self.meta.ok('quakes', len(q))

    # ------------------------------------------------------------ history and stats

    async def fuel_backfill(self) -> None:
        """Download one missing day of fuel history (newest first) per call."""
        yesterday = dt.date.today() - dt.timedelta(days=1)
        todo = H.next_missing(yesterday)
        if not todo:
            return
        d = todo[0]
        raw = await self.get(URLS['fuel_hist'] + f'{d:%d-%m-%Y}', accept='application/json', timeout=180)
        _, stations = F.fuel(raw)
        if not stations and d > dt.date(2007, 1, 31):
            raise RuntimeError(f'empty history for {d}')
        rows = await asyncio.to_thread(H.save_day, d, stations, self._dbpath())
        self.meta.ok('fuel_history', len(todo) - 1, f'{d.isoformat()}: {rows} prices')

    def _dbpath(self) -> str:
        return str(os.environ.get('RUTAVIVA_DATA', '/data') + '/archive.sqlite')

    async def nightly(self) -> None:
        years = await asyncio.to_thread(H.compact, 1)
        tr = await asyncio.to_thread(H.trends, self._dbpath())
        if tr:
            write_json('fuel-trends', tr)
        self.meta.ok('nightly', len(years), ','.join(map(str, years)))

    async def incident_stats(self) -> None:
        rows = self.con.execute('''SELECT cat, road, prov, first_seen, last_seen, start FROM incident
                                   WHERE first_seen >= datetime('now', '-400 day')''').fetchall()
        by_cat = Counter(r[0] for r in rows)
        by_road = Counter((r[1], r[0]) for r in rows if r[1])
        roads: dict[str, dict[str, int]] = {}
        for (road, cat), n in by_road.items():
            roads.setdefault(road, {})[cat] = n
        top = sorted(roads.items(), key=lambda kv: -sum(kv[1].values()))[:60]
        hours = Counter()
        for r in rows:
            if r[0] in ('accidente', 'retencion') and r[5]:
                m = re.search(r'T(\d{2}):', r[5])
                if m:
                    hours[int(m.group(1))] += 1
        since = self.con.execute('SELECT min(first_seen) FROM incident').fetchone()[0]
        write_json('incident-stats', {'since': since, 'total': len(rows), 'by_cat': by_cat,
                                      'roads': [{'road': k, **v, 'total': sum(v.values())} for k, v in top],
                                      'hours': [hours.get(h, 0) for h in range(24)]})
        self.meta.ok('incident_stats', len(rows))

    async def reve_sweep(self) -> None:
        assert self.reve
        res = await sweep(self.reve, sqlite3.connect(self._dbpath(), timeout=60), log.info)
        write_json('ev-ranking', ranking(sqlite3.connect(self._dbpath(), timeout=60)))
        self.meta.ok('reve_sweep', res['locations'], f"{res['calls']} calls, {res['details']} details")

    # ------------------------------------------------------------ scheduling

    async def every(self, name: str, seconds: float, fn: Callable[[], Awaitable[None]], *, delay: float = 0,
                    at_hour: int | None = None) -> None:
        await asyncio.sleep(delay)
        while True:
            if at_hour is not None:
                now = dt.datetime.now()
                nxt = now.replace(hour=at_hour, minute=0, second=0, microsecond=0)
                if nxt <= now:
                    nxt += dt.timedelta(days=1)
                last = (self.meta.state.get(name) or {}).get('updated', '')
                # Run at once if it never ran or the last run is older than a day.
                if last and last[:10] >= (dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(hours=26)).strftime('%Y-%m-%d') \
                        and (self.meta.state.get(name) or {}).get('ok'):
                    await asyncio.sleep((nxt - now).total_seconds())
            t0 = time.monotonic()
            try:
                await fn()
                log.info('%s ok in %.1fs', name, time.monotonic() - t0)
            except Exception as e:  # noqa: BLE001 - reported and retried on the next round
                log.error('%s failed: %s', name, e)
                log.debug(traceback.format_exc())
                self.meta.fail(name, str(e))
            if at_hour is None:
                await asyncio.sleep(seconds)

    async def backfill_loop(self) -> None:
        await asyncio.sleep(60)
        n = 0
        while True:
            try:
                await self.fuel_backfill()
                n += 1
                if n % 120 == 0:
                    await asyncio.to_thread(H.compact, 30)
                await asyncio.sleep(float(os.environ.get('RUTAVIVA_BACKFILL_PAUSE', '4')))
            except Exception as e:  # noqa: BLE001
                self.meta.fail('fuel_history', str(e))
                await asyncio.sleep(300)
            if not H.next_missing(dt.date.today() - dt.timedelta(days=1)):
                await asyncio.sleep(3600)

    # ------------------------------------------------------------ API

    async def api_station(self, request: web.Request) -> web.Response:
        sid = request.match_info['id']
        if not sid.isdigit() or len(sid) > 8:
            raise web.HTTPBadRequest()
        series = await asyncio.to_thread(H.station_series, int(sid))
        info = self.con.execute('SELECT brand, addr, muni, prov, first_day, last_day FROM station WHERE id=?',
                                (int(sid),)).fetchone()
        body = {'id': sid, 'series': series,
                'info': dict(zip(('brand', 'addr', 'muni', 'prov', 'first_day', 'last_day'), info)) if info else None}
        return web.json_response(body, headers={'Cache-Control': 'public, max-age=1800'})

    async def api_ev_markers(self, request: web.Request) -> web.Response:
        assert self.reve
        try:
            w, s, e, n = (float(x) for x in request.query['bbox'].split(','))
            z = int(float(request.query.get('z', '12')))
        except (KeyError, ValueError):
            raise web.HTTPBadRequest()
        if not (-19 < w < e < 5 and 27 < s < n < 44.5) or z < 10 or z > 18 or (e - w) > 1.6 or (n - s) > 1.2:
            raise web.HTTPBadRequest(text='bbox too large')
        try:
            data = await self.reve.markers(w, s, e, n, z)
        except Exception as err:  # noqa: BLE001
            raise web.HTTPBadGateway(text=str(err)[:200])
        out = []
        for m in data if isinstance(data, list) else []:
            loc = m.get('location') or {}
            out.append({'t': 'l' if m.get('type') == 'location' else 'c', 'lon': m.get('longitude'), 'lat': m.get('latitude'),
                        'n': m.get('total_evse'), 'id': loc.get('id'), 'name': loc.get('name'), 'status': loc.get('status')})
        return web.json_response(out, headers={'Cache-Control': 'public, max-age=60'})

    async def api_ev_location(self, request: web.Request) -> web.Response:
        assert self.reve
        lid = request.match_info['id']
        if not re.fullmatch(r'[0-9a-f-]{36}', lid):
            raise web.HTTPBadRequest()
        try:
            d = await self.reve.location(lid)
        except Exception as err:  # noqa: BLE001
            raise web.HTTPBadGateway(text=str(err)[:200])
        return web.json_response(summarize(d), headers={'Cache-Control': 'public, max-age=60'})

    async def api_health(self, _request: web.Request) -> web.Response:
        stale = []
        limits = {'incidents': 900, 'vms': 900, 'traffic': 1800, 'fuel': 7200, 'cameras': 86400, 'quakes': 3600}
        for feed, lim in limits.items():
            st = self.meta.state.get(feed) or {}
            upd = st.get('updated')
            if not upd or (dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.datetime.strptime(upd, '%Y-%m-%dT%H:%M:%SZ')).total_seconds() > lim:
                stale.append(feed)
        return web.json_response({'ok': not stale, 'stale': stale, 'feeds': self.meta.state},
                                 status=200 if not stale else 503)

    async def run(self) -> None:
        self.session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=8))
        self.reve = Reve(self.session)
        app = web.Application()
        app.router.add_get('/api/health', self.api_health)
        app.router.add_get('/api/fuel/station/{id}', self.api_station)
        app.router.add_get('/api/ev/markers', self.api_ev_markers)
        app.router.add_get('/api/ev/location/{id}', self.api_ev_location)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        await web.TCPSite(runner, os.environ.get('RUTAVIVA_HOST', '0.0.0.0'), int(os.environ.get('RUTAVIVA_PORT', '8080'))).start()
        tasks = [
            self.every('incidents', 180, self.incidents),
            self.every('vms', 180, self.vms, delay=5),
            self.every('traffic', 300, self.city_traffic, delay=8),
            self.every('fuel', 1800, self.fuel, delay=10),
            self.every('quakes', 600, self.quakes, delay=15),
            self.every('cameras', 6 * 3600, self.cameras, delay=20),
            self.every('radars', 3 * 3600, self.radars, delay=25),
            self.every('zbe', 24 * 3600, self.zbe, delay=30),
            self.every('ev', 24 * 3600, self.ev, delay=40),
            self.every('incident_stats', 3600, self.incident_stats, delay=120),
            self.every('nightly', 6 * 3600, self.nightly, delay=90),
            self.every('reve_sweep', 0, self.reve_sweep, at_hour=2, delay=300),
        ]
        if self.backfill_enabled:
            tasks.append(self.backfill_loop())
        await asyncio.gather(*tasks)


def decode6(s: str) -> list[tuple[float, float]]:
    """Decode a Valhalla polyline6 into (lon, lat) pairs."""
    out, idx, lat, lon = [], 0, 0, 0
    while idx < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[idx]) - 63
                idx += 1
                res |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append((lon / 1e6, lat / 1e6))
    return out


def main() -> None:
    logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'), format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(Worker().run())


if __name__ == '__main__':
    main()

