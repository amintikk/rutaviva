"""Daily fuel prices of every Spanish station since 2007 (MITECO historical endpoint).

Each day is saved as a small parquet file (station, fuel, price in thousandths of a euro);
compact() folds finished days into one file per year sorted by station, so the history of a
station is a quick DuckDB read. Station names and places live in the SQLite archive.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .feeds import FUEL_CODES
from .store import HIST

FUEL_INDEX = {c: i for i, c in enumerate(FUEL_CODES)}
FIRST_DAY = dt.date(2007, 1, 1)
DAYS = HIST / 'days'
YEARS = HIST / 'years'


def day_file(d: dt.date) -> Path:
    return DAYS / f'{d.year}' / f'{d:%Y%m%d}.parquet'


def _year_days(year: int) -> set[str]:
    try:
        return set(json.loads((YEARS / f'{year}.days.json').read_text()))
    except (OSError, ValueError):
        return set()


def done_days() -> set[str]:
    out: set[str] = set()
    if YEARS.exists():
        for f in YEARS.glob('*.days.json'):
            out |= set(json.loads(f.read_text()))
    if DAYS.exists():
        out |= {p.stem for p in DAYS.glob('*/*.parquet')}
    return out


def ensure_tables(con: sqlite3.Connection) -> None:
    con.execute('''CREATE TABLE IF NOT EXISTS station (
        id INTEGER PRIMARY KEY, brand TEXT, addr TEXT, muni TEXT, prov TEXT, prov_id TEXT,
        lon REAL, lat REAL, first_day TEXT, last_day TEXT)''')


def save_day(d: dt.date, stations: list[dict[str, Any]], dbpath: str) -> int:
    con = sqlite3.connect(dbpath, timeout=60)
    rows_s, rows_f, rows_p = [], [], []
    for s in stations:
        try:
            sid = int(s['id'])
        except (TypeError, ValueError):
            continue
        for code, price in s['p'].items():
            rows_s.append(sid)
            rows_f.append(FUEL_INDEX[code])
            rows_p.append(int(round(price * 1000)))
    table = pa.table({'station': pa.array(rows_s, pa.int32()), 'fuel': pa.array(rows_f, pa.uint8()),
                      'price': pa.array(rows_p, pa.uint16())})
    path = day_file(d)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    pq.write_table(table, tmp, compression='zstd')
    os.replace(tmp, path)
    ensure_tables(con)
    ds = d.isoformat()
    con.executemany('''INSERT INTO station (id, brand, addr, muni, prov, prov_id, lon, lat, first_day, last_day)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          brand = CASE WHEN excluded.last_day >= station.last_day THEN excluded.brand ELSE station.brand END,
          addr = CASE WHEN excluded.last_day >= station.last_day THEN excluded.addr ELSE station.addr END,
          muni = CASE WHEN excluded.last_day >= station.last_day THEN excluded.muni ELSE station.muni END,
          prov = CASE WHEN excluded.last_day >= station.last_day THEN excluded.prov ELSE station.prov END,
          lon = CASE WHEN excluded.last_day >= station.last_day THEN excluded.lon ELSE station.lon END,
          lat = CASE WHEN excluded.last_day >= station.last_day THEN excluded.lat ELSE station.lat END,
          first_day = min(station.first_day, excluded.first_day),
          last_day = max(station.last_day, excluded.last_day)''',
                    [(int(s['id']), s['brand'], s['addr'], s['muni'], s['prov'], s['prov_id'], s['lon'], s['lat'], ds, ds)
                     for s in stations if str(s['id']).isdigit()])
    con.commit()
    con.close()
    return len(rows_s)


def compact(min_days: int = 1) -> list[int]:
    """Fold day files into year files (current year included). Returns the years rewritten."""
    done = []
    if not DAYS.exists():
        return done
    for ydir in sorted(DAYS.iterdir()):
        files = sorted(ydir.glob('*.parquet'))
        if len(files) < min_days:
            continue
        year = int(ydir.name)
        YEARS.mkdir(parents=True, exist_ok=True)
        target = YEARS / f'{year}.parquet'
        parts = []
        if target.exists():
            parts.append(f"SELECT station, fuel, day, price FROM read_parquet('{target}')")
        lst = ','.join(f"'{f}'" for f in files)
        parts.append(f"""SELECT station, fuel, strptime(regexp_extract(filename, '(\\d{{8}})\\.parquet$', 1), '%Y%m%d')::DATE AS day,
                         price FROM read_parquet([{lst}], filename=true)""")
        tmp = target.with_suffix('.tmp')
        con = duckdb.connect()
        con.execute("SET memory_limit='1500MB'; SET threads=2")
        con.execute(f"""COPY (SELECT station, fuel, day, price FROM ({' UNION ALL '.join(parts)})
                         ORDER BY station, fuel, day) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
        con.close()
        days = _year_days(year) | {f.stem for f in files}
        os.replace(tmp, target)
        (YEARS / f'{year}.days.json').write_text(json.dumps(sorted(days)))
        for f in files:
            f.unlink()
        done.append(year)
    return done


def _sources() -> str:
    parts = []
    if YEARS.exists() and any(YEARS.glob('*.parquet')):
        parts.append(f"SELECT station, fuel, day, price FROM read_parquet('{YEARS}/*.parquet')")
    if DAYS.exists() and any(DAYS.glob('*/*.parquet')):
        parts.append(f"""SELECT station, fuel, strptime(regexp_extract(filename, '(\\d{{8}})\\.parquet$', 1), '%Y%m%d')::DATE AS day,
                         price FROM read_parquet('{DAYS}/*/*.parquet', filename=true)""")
    return ' UNION ALL '.join(parts)


def station_series(station: int) -> dict[str, list[list[Any]]]:
    src = _sources()
    if not src:
        return {}
    con = duckdb.connect()
    rows = con.execute(f'SELECT fuel, day, price FROM ({src}) WHERE station = ? ORDER BY fuel, day', [station]).fetchall()
    con.close()
    out: dict[str, list[list[Any]]] = {}
    last: dict[int, int] = {}
    for fuel, day, price in rows:
        # Only keep the days the price changed (plus the last one): the chart draws steps.
        if last.get(fuel) == price:
            continue
        last[fuel] = price
        out.setdefault(FUEL_CODES[fuel], []).append([day.isoformat(), price / 1000])
    return out


def trends(dbpath: str) -> dict[str, Any]:
    """National daily medians, weekday pattern, brand ranking and province averages."""
    src = _sources()
    if not src:
        return {}
    main = [FUEL_INDEX[c] for c in ('g95', 'diesel', 'g98', 'glp') if c in FUEL_INDEX]
    con = duckdb.connect()
    con.execute("SET memory_limit='1500MB'; SET threads=2")
    con.execute(f'CREATE TEMP VIEW p AS SELECT * FROM ({src}) WHERE fuel IN ({",".join(map(str, main))})')
    daily = con.execute('''SELECT fuel, day, median(price)::INT, count(*) FROM p GROUP BY ALL ORDER BY fuel, day''').fetchall()
    national: dict[str, list[list[Any]]] = {}
    for fuel, day, med, n in daily:
        national.setdefault(FUEL_CODES[fuel], []).append([day.isoformat(), med / 1000, n])
    # Weekday effect over the last 365 days: each station's price relative to its own weekly mean.
    weekday = con.execute('''
        WITH recent AS (SELECT * FROM p WHERE day >= (SELECT max(day) FROM p) - INTERVAL 365 DAY),
        w AS (SELECT station, fuel, date_trunc('week', day) wk, avg(price) m FROM recent GROUP BY ALL)
        SELECT r.fuel, isodow(r.day) dow, avg(r.price - w.m) / 1000 diff, count(*)
        FROM recent r JOIN w ON w.station = r.station AND w.fuel = r.fuel AND w.wk = date_trunc('week', r.day)
        GROUP BY ALL ORDER BY 1, 2''').fetchall()
    wk: dict[str, list[float]] = {}
    for fuel, dow, diff, _n in weekday:
        wk.setdefault(FUEL_CODES[fuel], [0.0] * 7)[dow - 1] = round(diff, 4)
    last_day = con.execute('SELECT max(day) FROM p').fetchone()[0]
    con.execute(f"CREATE TEMP TABLE last30 AS SELECT * FROM p WHERE day > DATE '{last_day}' - INTERVAL 30 DAY")
    con_sqlite = sqlite3.connect(dbpath, timeout=60)
    st = con_sqlite.execute('SELECT id, brand, prov FROM station').fetchall()
    con_sqlite.close()
    con.execute('CREATE TEMP TABLE st (id INTEGER, brand VARCHAR, prov VARCHAR)')
    con.executemany('INSERT INTO st VALUES (?,?,?)', st)
    brands = con.execute('''
        WITH b AS (SELECT upper(trim(regexp_replace(st.brand, '\\s+(S\\.?A\\.?|S\\.?L\\.?)$', ''))) brand, l.fuel, l.price, l.station
                   FROM last30 l JOIN st ON st.id = l.station)
        SELECT brand, fuel, median(price)::INT, count(DISTINCT station) n FROM b GROUP BY ALL HAVING count(DISTINCT station) >= 40
        ORDER BY fuel, 3''').fetchall()
    br: dict[str, list[list[Any]]] = {}
    for brand, fuel, med, n in brands:
        br.setdefault(FUEL_CODES[fuel], []).append([brand.title(), med / 1000, n])
    prov = con.execute('''SELECT st.prov, l.fuel, median(l.price)::INT, count(DISTINCT l.station)
        FROM last30 l JOIN st ON st.id = l.station WHERE st.prov <> '' GROUP BY ALL ORDER BY 2, 3''').fetchall()
    pv: dict[str, list[list[Any]]] = {}
    for p, fuel, med, n in prov:
        pv.setdefault(FUEL_CODES[fuel], []).append([p, med / 1000, n])
    con.close()
    return {'last_day': last_day.isoformat() if last_day else None, 'national': national, 'weekday': wk,
            'brands': br, 'provinces': pv}


def next_missing(limit_to: dt.date) -> list[dt.date]:
    """Days not yet downloaded, newest first."""
    have = done_days()
    out = []
    d = limit_to
    while d >= FIRST_DAY:
        if f'{d:%Y%m%d}' not in have:
            out.append(d)
        d -= dt.timedelta(days=1)
    return out
