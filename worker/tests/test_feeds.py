"""Readers against real publications saved on 2026-11-21/22 (tests/fixtures, gzip)."""
import datetime as dt
import gzip
import json
from collections import Counter
from pathlib import Path

import pytest

from rutaviva import feeds as F

FX = Path(__file__).parent / 'fixtures'


def fx(name: str) -> bytes:
    return gzip.open(FX / name).read()


def test_dgt_incidents():
    inc = F.incidents(fx('dgt_incidencias.xml.gz'), 'dgt')
    assert len(inc) > 600
    cats = Counter(i['cat'] for i in inc)
    assert cats['obras'] > 100 and cats['accidente'] > 0
    first = inc[0]
    assert first['id'] == 'dgt:18811074'
    assert first['road'] == 'N-400' and first['prov'] == 'Toledo' and first['muni'] == 'Ontígola'
    assert first['km'] == 37.3
    # [from, to] in (lon, lat)
    assert first['pts'][0] == (-3.607499, 39.993732)
    assert all(-19 < p[0] < 5 and 27 < p[1] < 44.5 for i in inc for p in i['pts'])


def test_regional_incidents():
    sct = F.incidents(fx('sct_incidencias.xml.gz'), 'sct')
    gv = F.incidents(fx('gv_incidencias.xml.gz'), 'gv')
    assert len(sct) > 100 and len(gv) > 50
    assert sct[0]['road'] == 'BV-4023' and sct[0]['cat'] == 'obras'
    assert any(i['cat'] == 'retencion' for i in gv) or any(i['cat'] == 'obras' for i in gv)


@pytest.mark.parametrize('text,cat', [
    ('Accident accident', 'accidente'), ('PoorEnvironmentConditions snowfall', 'nieve'),
    ('RoadOrCarriagewayOrLaneManagement roadClosed', 'cerrada'), ('MaintenanceWorks roadworks', 'obras'),
    ('AbnormalTraffic slowTraffic', 'retencion'), ('service device police', 'otro'),
    ('VehicleObstruction brokenDownVehicle', 'obstaculo'), ('PoorEnvironmentConditions fog', 'meteo'),
])
def test_classify(text, cat):
    assert F.classify(text) == cat


def test_cameras_and_vms():
    cams = F.cameras(fx('dgt_camaras.xml.gz'))
    assert len(cams) == 1980
    c = cams[0]
    assert c['id'] == '176130' and c['road'] == 'A-62' and c['img'].endswith('/176130.jpg')
    panels = F.vms(fx('dgt_paneles.xml.gz'), fx('dgt_paneles_loc.xml.gz'))
    on = [p for p in panels if p['lines']]
    assert len(panels) > 2000 and len(on) > 500
    assert not any('false' in line for p in on for line in p['lines'])
    assert not any(line.startswith('@') for p in on for line in p['lines'])


def test_radars_and_stretches():
    r = F.radars(fx('dgt_radares.xml.gz'))
    kinds = Counter(x['kind'] for x in r)
    assert kinds['fijo'] == 690 and kinds['tramo'] == 47
    t = next(x for x in r if x['kind'] == 'tramo')
    assert t['road'] == 'Z-40' and t['km'] == 26.6 and t['km2'] == 29.7 and t['len'] == 3.1
    inv = F.stretches(fx('dgt_invive.xml.gz'))
    assert len(inv) > 1000 and all(len(s['line']) >= 1 for s in inv)
    motos = F.stretches(fx('dgt_motos.xml.gz'))
    assert len(motos) > 50 and motos[0]['road'] == 'GC-240' and motos[0]['km'] == 1.5


def test_zbe():
    z = F.zbe(fx('zbe_pontevedra.xml.gz'), 'Pontevedra')
    assert len(z) == 1 and z[0]['polys'] and len(z[0]['polys'][0]) >= 3
    assert z[0]['banned'] is None  # all five badges listed: meaning unclear


@pytest.mark.parametrize('listed,banned', [
    (['A'], ['A']), (['A', 'B', 'C'], ['A', 'B', 'C']), (['B', 'C', 'ECO', '0'], ['A']),
    (['ECO', '0'], ['A', 'B', 'C']), (['A', 'B', 'C', 'ECO', '0'], None), ([], None),
])
def test_banned_badges(listed, banned):
    assert F.banned_badges(listed) == banned


def test_charging():
    s = F.charging(fx('miterd_recarga.xml.gz'))
    assert len(s) == 60
    assert s[0]['id'] == '2023002088' and s[0]['kw'] == 350.0 and s[0]['conns'] == {'CCS': 1} and s[0]['muni'] == 'Palma'


def test_fuel():
    stamp, st = F.fuel(fx('miteco_precios.json.gz'))
    assert stamp.startswith('22/11/2026') and len(st) == 40
    a = st[0]
    assert a['id'] == '4375' and a['p']['diesel'] == 1.699 and a['p']['g95'] == 1.399 and a['public']


def test_fuel_history_roundtrip(tmp_path, monkeypatch):
    from rutaviva import fuelhist as H
    monkeypatch.setattr(H, 'DAYS', tmp_path / 'days')
    monkeypatch.setattr(H, 'YEARS', tmp_path / 'years')
    monkeypatch.setattr(H, 'HIST', tmp_path)
    _, st = F.fuel(fx('miteco_precios.json.gz'))
    db = str(tmp_path / 'a.sqlite')
    H.save_day(dt.date(2026, 11, 20), st, db)
    st2 = json.loads(json.dumps(st))
    st2[0]['p']['diesel'] = 1.659
    H.save_day(dt.date(2026, 11, 21), st2, db)
    assert H.done_days() == {'20261120', '20261121'}
    assert H.compact(1) == [2026]
    s = H.station_series(4375)
    assert s['diesel'] == [['2026-11-20', 1.699], ['2026-11-21', 1.659]]
    assert s['g95'] == [['2026-11-20', 1.399]]  # unchanged price: one step only
    assert H.next_missing(dt.date(2026, 11, 22))[0] == dt.date(2026, 11, 22)
