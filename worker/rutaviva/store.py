"""Where the worker writes: live GeoJSON for the map, the incident archive and feed status."""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

DATA = Path(os.environ.get('RUTAVIVA_DATA', '/data'))
LIVE = DATA / 'live'      # served by nginx as /live/
HIST = DATA / 'hist'      # fuel price history (parquet)
DB = DATA / 'archive.sqlite'


def now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def write_json(name: str, obj: Any) -> int:
    """Atomic write of live/<name>.json plus a .gz twin for nginx gzip_static. Returns bytes."""
    LIVE.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()
    for path, blob in ((LIVE / f'{name}.json', raw), (LIVE / f'{name}.json.gz', gzip.compress(raw, 7))):
        tmp = path.with_suffix(path.suffix + '.tmp')
        tmp.write_bytes(blob)
        os.replace(tmp, path)
    return len(raw)


def read_json(name: str, default: Any = None) -> Any:
    try:
        return json.loads((LIVE / f'{name}.json').read_bytes())
    except (OSError, ValueError):
        return default


def feature(lon: float, lat: float, props: dict[str, Any], geom: dict | None = None) -> dict:
    return {'type': 'Feature', 'geometry': geom or {'type': 'Point', 'coordinates': [lon, lat]}, 'properties': props}


def collection(features: list[dict], **extra: Any) -> dict:
    return {'type': 'FeatureCollection', 'features': features, **extra}


class Meta:
    """live/meta.json: per feed, when it last worked, how many items and the last error."""

    def __init__(self) -> None:
        self.state: dict[str, dict[str, Any]] = read_json('meta', {}).get('feeds', {}) if read_json('meta') else {}

    def ok(self, feed: str, count: int, source_time: str = '') -> None:
        self.state[feed] = {'ok': True, 'updated': now_iso(), 'count': count, 'source_time': source_time, 'error': ''}
        self.flush()

    def fail(self, feed: str, error: str) -> None:
        prev = self.state.get(feed, {})
        self.state[feed] = {**prev, 'ok': False, 'error': error[:300], 'failed_at': now_iso()}
        self.flush()

    def flush(self) -> None:
        write_json('meta', {'generated': now_iso(), 'feeds': self.state})


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=30)
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript('''
        CREATE TABLE IF NOT EXISTS incident (
            id TEXT PRIMARY KEY, src TEXT, cat TEXT, road TEXT, km REAL, prov TEXT, muni TEXT,
            lon REAL, lat REAL, start TEXT, first_seen TEXT, last_seen TEXT, what TEXT);
        CREATE INDEX IF NOT EXISTS incident_road ON incident(road);
        CREATE INDEX IF NOT EXISTS incident_seen ON incident(first_seen);
        CREATE TABLE IF NOT EXISTS charger (
            id TEXT PRIMARY KEY, name TEXT, owner TEXT, lon REAL, lat REAL, evses INTEGER, source TEXT,
            detail_at TEXT);
        CREATE TABLE IF NOT EXISTS charger_obs (
            day TEXT, id TEXT, status TEXT, evses INTEGER, PRIMARY KEY (day, id));
        CREATE TABLE IF NOT EXISTS evse_obs (
            day TEXT, location TEXT, evse TEXT, status TEXT, kw REAL, price REAL, PRIMARY KEY (day, evse));
    ''')
    return con
