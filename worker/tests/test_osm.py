"""DGT / OpenStreetMap radar merge."""
from rutaviva import osm as O


def test_radar_merge():
    dgt = [{'id': 'a', 'lon': -3.70, 'lat': 40.40}, {'id': 'b', 'lon': -4.0, 'lat': 41.0}]
    osm = [{'id': 'osm:1', 'lon': -3.7005, 'lat': 40.4004, 'maxspeed': 90},     # same spot as "a"
           {'id': 'osm:2', 'lon': 2.17, 'lat': 41.39, 'maxspeed': 50},          # Barcelona: not in the DGT list
           {'id': 'osm:3', 'lon': 2.18, 'lat': 41.40, 'maxspeed': 50, 'temporary': True}]
    merged, extra = O.merge(dgt, osm)
    assert merged[0]['maxspeed'] == 90 and 'maxspeed' not in merged[1]
    assert [o['id'] for o in extra] == ['osm:2']
