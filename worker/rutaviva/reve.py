"""Live state and prices of public chargers from REVE, Red Eléctrica's official charging map.

REVE gathers the dynamic data (availability per connector and ad-hoc price) that charge point
operators must report under Orden TED/445/2023 and the EU AFIR. Its public web API has no
documented reuse terms, so it is used gently: answers are cached, all calls share one slow
lane, and the daily sweep that feeds the reliability ranking spaces its requests out.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import sqlite3
import time
from typing import Any

import aiohttp

BASE = 'https://www.mapareve.es/api/public/v1'
HEADERS = {'Accept': 'application/json', 'Content-Type': 'application/json',
           'User-Agent': 'RutaViva/1.0 (+https://rutaviva.aminox.dev/fuentes/)'}


class Reve:
    def __init__(self, session: aiohttp.ClientSession, min_interval: float = 0.35) -> None:
        self.s = session
        self.lock = asyncio.Lock()
        self.min_interval = min_interval
        self.last = 0.0
        self.cache: dict[str, tuple[float, Any]] = {}

    async def _call(self, method: str, path: str, body: dict | None = None) -> Any:
        async with self.lock:
            wait = self.min_interval - (time.monotonic() - self.last)
            if wait > 0:
                await asyncio.sleep(wait)
            self.last = time.monotonic()
        async with self.s.request(method, BASE + path, json=body, headers=HEADERS,
                                  timeout=aiohttp.ClientTimeout(total=25)) as r:
            data = await r.json(content_type=None)
            if r.status >= 400:
                raise RuntimeError(f'REVE {r.status}: {str(data)[:120]}')
            return data

    async def cached(self, key: str, ttl: float, fn) -> Any:
        hit = self.cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        val = await fn()
        self.cache[key] = (time.monotonic(), val)
        if len(self.cache) > 4000:
            for k in sorted(self.cache, key=lambda k: self.cache[k][0])[:1000]:
                self.cache.pop(k, None)
        return val

    async def markers(self, w: float, s: float, e: float, n: float, zoom: int) -> Any:
        # Round the box so neighbouring requests share the cache.
        q = 0.02 if zoom >= 12 else 0.1
        w, s = (round(v / q - 0.5) * q for v in (w, s))
        e, n = (round(v / q + 0.5) * q for v in (e, n))
        body = {'latitude_ne': round(n, 4), 'latitude_sw': round(s, 4), 'longitude_ne': round(e, 4),
                'longitude_sw': round(w, 4), 'zoom': int(zoom)}
        return await self.cached(json.dumps(body, sort_keys=True), 90, lambda: self._call('POST', '/markers', body))

    async def location(self, loc_id: str) -> Any:
        return await self.cached(f'loc:{loc_id}', 60, lambda: self._call('GET', f'/locations/{loc_id}'))

    async def cpos(self) -> Any:
        return await self.cached('cpos', 86400, lambda: self._call('GET', '/cpos?per_page=500'))


def summarize(detail: dict[str, Any]) -> dict[str, Any]:
    """Compact view of a REVE location for the map's detail sheet."""
    evses = []
    for e in detail.get('evses') or []:
        conns = []
        for c in e.get('connectors') or []:
            prices = []
            for t in c.get('tariffs') or []:
                prices += t.get('human') or []
            conns.append({'std': c.get('standard'), 'kw': round((c.get('max_electric_power') or 0) / 1000, 1),
                          'price': prices[:3]})
        evses.append({'id': e.get('evse_id'), 'ref': e.get('physical_reference'), 'status': e.get('status'),
                      'since': e.get('status_updated_at'), 'conns': conns, 'pay': e.get('payment_methods') or []})
    owner = detail.get('owner') or {}
    ot = detail.get('opening_times') or {}
    return {'id': detail.get('id'), 'name': detail.get('name'), 'addr': detail.get('address'),
            'cp': detail.get('postal_code'), 'owner': owner.get('name'), 'web': owner.get('website'),
            'phone': owner.get('phone'), 'h24': bool(ot.get('twentyfourseven')), 'evses': evses,
            'lat': float((detail.get('coordinates') or {}).get('latitude') or 0),
            'lon': float((detail.get('coordinates') or {}).get('longitude') or 0)}


# Mainland + Balearics, Canaries, Ceuta and Melilla, as [west, south, east, north].
REGIONS = [(-9.6, 35.8, 4.5, 43.9), (-18.3, 27.5, -13.3, 29.5)]


async def sweep(reve: Reve, con: sqlite3.Connection, log=print, pause: float = 1.5) -> dict[str, int]:
    """Walk Spain box by box, splitting every box that still returns clusters, and store the
    status of every charging location seen today. Then fetch the owner of locations not seen
    before (one detail call each, also spaced out)."""
    today = dt.date.today().isoformat()
    seen: dict[str, dict[str, Any]] = {}
    calls = 0

    async def visit(w: float, s: float, e: float, n: float, z: int) -> None:
        nonlocal calls
        await asyncio.sleep(pause)
        calls += 1
        try:
            data = await reve._call('POST', '/markers', {'latitude_ne': n, 'latitude_sw': s, 'longitude_ne': e,
                                                         'longitude_sw': w, 'zoom': z})
        except RuntimeError as err:
            if 'too large' in str(err).lower() or '2001' in str(err):
                mx, my = (w + e) / 2, (s + n) / 2
                for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                    await visit(*box, z)
                return
            raise
        clusters = 0
        for m in data if isinstance(data, list) else []:
            if m.get('type') == 'location' and m.get('location'):
                loc = m['location']
                seen[loc['id']] = loc
            elif m.get('type') == 'cluster':
                clusters += 1
        if clusters and z < 18:
            mx, my = (w + e) / 2, (s + n) / 2
            for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                await visit(*box, z + 1)

    for w, s, e, n in REGIONS:
        step = 2.0
        x = w
        while x < e:
            y = s
            while y < n:
                await visit(x, y, min(x + step, e), min(y + step, n), 9)
                y += step
            x += step
    con.executemany('INSERT OR REPLACE INTO charger_obs (day, id, status, evses) VALUES (?,?,?,?)',
                    [(today, k, v.get('status') or '', v.get('total_evse') or 0) for k, v in seen.items()])
    con.executemany('''INSERT INTO charger (id, name, lon, lat, evses, source) VALUES (?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name, lon=excluded.lon, lat=excluded.lat,
                       evses=excluded.evses, source=excluded.source''',
                    [(k, v.get('name'), v.get('longitude'), v.get('latitude'), v.get('total_evse'), v.get('source_type'))
                     for k, v in seen.items()])
    con.commit()
    log(f'reve sweep: {len(seen)} locations, {calls} calls')
    missing = [r[0] for r in con.execute('SELECT id FROM charger WHERE owner IS NULL ORDER BY random() LIMIT 3000')]
    got = 0
    for loc_id in missing:
        await asyncio.sleep(pause)
        try:
            d = await reve._call('GET', f'/locations/{loc_id}')
        except Exception:  # noqa: BLE001 - a missing detail only delays this location
            continue
        owner = (d.get('owner') or {}).get('name') or '—'
        con.execute('UPDATE charger SET owner=?, detail_at=? WHERE id=?', (owner, today, loc_id))
        for e in d.get('evses') or []:
            kw = max(((c.get('max_electric_power') or 0) / 1000 for c in e.get('connectors') or []), default=0)
            price = None
            for c in e.get('connectors') or []:
                for t in c.get('tariffs') or []:
                    for el in (t.get('tariff') or {}).get('elements') or []:
                        for pc in el.get('price_components') or []:
                            if pc.get('type') == 'ENERGY' and pc.get('price') is not None:
                                price = pc['price'] * (1 + (pc.get('vat') or 0) / 100) if price is None else price
            con.execute('INSERT OR REPLACE INTO evse_obs (day, location, evse, status, kw, price) VALUES (?,?,?,?,?,?)',
                        (today, loc_id, e.get('evse_id'), e.get('status'), kw, price))
        got += 1
        if got % 100 == 0:
            con.commit()
    con.commit()
    return {'locations': len(seen), 'calls': calls, 'details': got}


def ranking(con: sqlite3.Connection) -> dict[str, Any]:
    """Share of out-of-order chargers per operator (latest sweep) and prices by power band."""
    day = con.execute('SELECT max(day) FROM charger_obs').fetchone()[0]
    if not day:
        return {}
    rows = con.execute('''
        SELECT c.owner, count(*) n,
               sum(o.status = 'OUTOFORDER') broken, sum(o.status = 'AVAILABLE') free,
               sum(o.status IN ('CHARGING', 'BLOCKED', 'RESERVED')) busy, sum(o.status IN ('UNKNOWN', '')) unknown
        FROM charger_obs o JOIN charger c ON c.id = o.id
        WHERE o.day = ? AND c.owner IS NOT NULL AND c.owner <> '—'
        GROUP BY c.owner HAVING count(*) >= 25 ORDER BY 1.0 * broken / count(*) DESC''', (day,)).fetchall()
    totals = con.execute('''SELECT count(*), sum(status = 'OUTOFORDER'), sum(status = 'AVAILABLE'),
        sum(status IN ('CHARGING','BLOCKED','RESERVED')) FROM charger_obs WHERE day = ?''', (day,)).fetchone()
    pday = con.execute('SELECT max(day) FROM evse_obs').fetchone()[0]
    prices = []
    if pday:
        for band, lo, hi in (('Lenta (<22 kW)', 0, 21.9), ('Semirrápida (22–49 kW)', 22, 49.9),
                             ('Rápida (50–149 kW)', 50, 149.9), ('Ultrarrápida (≥150 kW)', 150, 10000)):
            vals = sorted(r[0] for r in con.execute(
                'SELECT price FROM evse_obs WHERE day >= date(?, "-14 day") AND price > 0 AND price < 2 AND kw BETWEEN ? AND ?',
                (pday, lo, hi)))
            if len(vals) >= 20:
                prices.append({'band': band, 'n': len(vals), 'p25': round(vals[len(vals) // 4], 3),
                               'median': round(vals[len(vals) // 2], 3), 'p75': round(vals[3 * len(vals) // 4], 3)})
    history = con.execute('''SELECT day, count(*), sum(status = 'OUTOFORDER') FROM charger_obs GROUP BY day ORDER BY day''').fetchall()
    return {'day': day, 'total': totals[0], 'broken': totals[1], 'available': totals[2], 'busy': totals[3],
            'operators': [{'name': r[0], 'n': r[1], 'broken': r[2], 'free': r[3], 'busy': r[4], 'unknown': r[5]} for r in rows],
            'prices': prices, 'history': [[d, n, b] for d, n, b in history]}
