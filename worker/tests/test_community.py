"""Community warnings and the DGT / OpenStreetMap radar merge."""
import sqlite3

import pytest

from rutaviva import osm as O
from rutaviva import reports as R


@pytest.fixture
def con():
    c = sqlite3.connect(':memory:')
    R.ensure(c)
    return c


def test_report_lifecycle(con):
    a = R.add(con, 'radar_movil', -3.70, 40.42, '1.2.3.4')
    assert not a['merged']
    # The same warning 100 m away from someone else is a confirmation, not a duplicate.
    b = R.add(con, 'radar_movil', -3.7012, 40.4205, '5.6.7.8')
    assert b == {'id': a['id'], 'merged': True}
    items = R.active(con)
    assert len(items) == 1 and items[0]['ups'] == 2 and items[0]['label'] == 'Radar móvil'
    # One vote per person; two "ya no está" more than confirmations remove it.
    assert R.vote(con, a['id'], True, '5.6.7.8')['repeat']
    R.vote(con, a['id'], False, '9.9.9.1')
    R.vote(con, a['id'], False, '9.9.9.2')
    assert R.active(con)[0]['downs'] == 2
    R.vote(con, a['id'], False, '9.9.9.3')
    assert R.active(con) == []


def test_report_validation_and_limits(con):
    with pytest.raises(ValueError):
        R.add(con, 'ovni', -3.7, 40.4, 'x')
    with pytest.raises(ValueError):
        R.add(con, 'control', 2.35, 48.85, 'x')  # Paris
    for i in range(R.PER_HOUR):
        R.add(con, 'control', -3.7 + i * 0.05, 40.4, 'spammer')
    with pytest.raises(R.LimitError):
        R.add(con, 'control', -1.0, 40.4, 'spammer')
    # The address is never stored, only a salted hash.
    assert not con.execute("SELECT count(*) FROM report WHERE author LIKE '%spammer%'").fetchone()[0]


def test_radar_merge():
    dgt = [{'id': 'a', 'lon': -3.70, 'lat': 40.40}, {'id': 'b', 'lon': -4.0, 'lat': 41.0}]
    osm = [{'id': 'osm:1', 'lon': -3.7005, 'lat': 40.4004, 'maxspeed': 90},     # same spot as "a"
           {'id': 'osm:2', 'lon': 2.17, 'lat': 41.39, 'maxspeed': 50},          # Barcelona: not in the DGT list
           {'id': 'osm:3', 'lon': 2.18, 'lat': 41.40, 'maxspeed': 50, 'temporary': True}]
    merged, extra = O.merge(dgt, osm)
    assert merged[0]['maxspeed'] == 90 and 'maxspeed' not in merged[1]
    assert [o['id'] for o in extra] == ['osm:2']
