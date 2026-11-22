"""Warnings sent by visitors (mobile speed camera, police check, accident...), like the ones drivers
share in community traffic apps. They expire on their own, other visitors confirm or deny them, and
nothing personal is stored: only a salted hash of the address, renewed daily, to rate-limit and to
allow one vote per person."""
from __future__ import annotations

import datetime as dt
import hashlib
import math
import secrets
import sqlite3
import time
from typing import Any

KINDS: dict[str, dict[str, Any]] = {
    'radar_movil': {'label': 'Radar móvil', 'ttl': 90},
    'control': {'label': 'Control policial', 'ttl': 60},
    'accidente': {'label': 'Accidente', 'ttl': 60},
    'obstaculo': {'label': 'Obstáculo en la vía', 'ttl': 45},
    'atasco': {'label': 'Retención', 'ttl': 40},
    'vehiculo_parado': {'label': 'Vehículo parado', 'ttl': 40},
}
MAX_TTL_MIN = 240
PER_HOUR = 8          # new warnings per person and hour
VOTES_PER_HOUR = 40
SPAIN = (-18.5, 27.4, 4.6, 44.0)

_salt = (dt.date.today(), secrets.token_hex(16))


def who(client: str) -> str:
    """Daily-salted hash of the client address (the address itself is never stored)."""
    global _salt
    if _salt[0] != dt.date.today():
        _salt = (dt.date.today(), secrets.token_hex(16))
    return hashlib.sha256(f'{_salt[1]}|{client}'.encode()).hexdigest()[:20]


def ensure(con: sqlite3.Connection) -> None:
    con.executescript('''
        CREATE TABLE IF NOT EXISTS report (
            id TEXT PRIMARY KEY, kind TEXT, lon REAL, lat REAL, created REAL, expires REAL,
            ups INTEGER DEFAULT 1, downs INTEGER DEFAULT 0, last_confirmed REAL, author TEXT, removed INTEGER DEFAULT 0);
        CREATE INDEX IF NOT EXISTS report_exp ON report(expires);
        CREATE TABLE IF NOT EXISTS report_vote (report TEXT, voter TEXT, up INTEGER, at REAL, PRIMARY KEY (report, voter));
    ''')


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 85, (a[1] - b[1]) * 111)


class LimitError(Exception):
    pass


def add(con: sqlite3.Connection, kind: str, lon: float, lat: float, client: str) -> dict[str, Any]:
    if kind not in KINDS:
        raise ValueError('tipo de aviso desconocido')
    if not (SPAIN[0] < lon < SPAIN[2] and SPAIN[1] < lat < SPAIN[3]):
        raise ValueError('fuera de España')
    now = time.time()
    me = who(client)
    n = con.execute('SELECT count(*) FROM report WHERE author=? AND created > ?', (me, now - 3600)).fetchone()[0]
    if n >= PER_HOUR:
        raise LimitError('demasiados avisos seguidos; prueba más tarde')
    # The same warning nearby counts as a confirmation instead of a duplicate.
    for rid, rlon, rlat in con.execute('SELECT id, lon, lat FROM report WHERE kind=? AND expires > ? AND removed=0', (kind, now)):
        if _km((lon, lat), (rlon, rlat)) < 0.35:
            vote(con, rid, True, client)
            return {'id': rid, 'merged': True}
    rid = secrets.token_hex(6)
    ttl = KINDS[kind]['ttl'] * 60
    con.execute('INSERT INTO report (id, kind, lon, lat, created, expires, ups, downs, last_confirmed, author) VALUES (?,?,?,?,?,?,1,0,?,?)',
                (rid, kind, round(lon, 5), round(lat, 5), now, now + ttl, now, me))
    con.execute('INSERT OR REPLACE INTO report_vote (report, voter, up, at) VALUES (?,?,1,?)', (rid, me, now))
    con.commit()
    return {'id': rid, 'merged': False}


def vote(con: sqlite3.Connection, rid: str, up: bool, client: str) -> dict[str, Any]:
    now = time.time()
    me = who(client)
    n = con.execute('SELECT count(*) FROM report_vote WHERE voter=? AND at > ?', (me, now - 3600)).fetchone()[0]
    if n >= VOTES_PER_HOUR:
        raise LimitError('demasiados votos seguidos')
    row = con.execute('SELECT kind, created, expires, ups, downs FROM report WHERE id=? AND removed=0', (rid,)).fetchone()
    if not row or row[2] < now:
        raise KeyError(rid)
    kind, created, expires, ups, downs = row
    prev = con.execute('SELECT up FROM report_vote WHERE report=? AND voter=?', (rid, me)).fetchone()
    if prev is not None:
        return {'id': rid, 'ups': ups, 'downs': downs, 'repeat': True}
    con.execute('INSERT INTO report_vote (report, voter, up, at) VALUES (?,?,?,?)', (rid, me, int(up), now))
    if up:
        ups += 1
        # Each confirmation keeps it alive a while longer, up to MAX_TTL_MIN after it was created.
        expires = min(max(expires, now + KINDS[kind]['ttl'] * 60), created + MAX_TTL_MIN * 60)
        con.execute('UPDATE report SET ups=?, expires=?, last_confirmed=? WHERE id=?', (ups, expires, now, rid))
    else:
        downs += 1
        removed = int(downs >= ups + 1 and downs >= 2)
        con.execute('UPDATE report SET downs=?, removed=? WHERE id=?', (downs, removed, rid))
    con.commit()
    return {'id': rid, 'ups': ups, 'downs': downs}


def active(con: sqlite3.Connection) -> list[dict[str, Any]]:
    now = time.time()
    rows = con.execute('''SELECT id, kind, lon, lat, created, expires, ups, downs, last_confirmed FROM report
                          WHERE expires > ? AND removed=0 ORDER BY created DESC LIMIT 2000''', (now,)).fetchall()
    return [{'id': r[0], 'kind': r[1], 'lon': r[2], 'lat': r[3],
             'created': dt.datetime.fromtimestamp(r[4], dt.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
             'expires': dt.datetime.fromtimestamp(r[5], dt.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
             'confirmed': dt.datetime.fromtimestamp(r[8] or r[4], dt.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
             'ups': r[6], 'downs': r[7], 'label': KINDS.get(r[1], {}).get('label', r[1])} for r in rows]
