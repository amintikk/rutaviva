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


def test_dgt_lists():
    from pathlib import Path
    from rutaviva import dgt_radares as D
    fx = Path(__file__).parent / 'fixtures'
    inf = D.parse_informe((fx / 'dgt_informe_cinemometros.txt').read_text())
    kinds = {r['kind'] for r in inf}
    assert {'fijo', 'movil', 'tramo'} <= kinds
    first = inf[0]
    assert first == {'prov': 'Albacete', 'road': 'A-31', 'kind': 'fijo', 'km': 50.601, 'km2': None, 'dir': 'positive', 'date': '03/08/2026'}
    t = next(r for r in inf if r['kind'] == 'tramo')
    # CM-412 km 202.5, decreasing, 5.638 m long -> ends at km 196.862
    assert t['road'] == 'CM-412' and t['len_m'] == 5638 and t['km2'] == 196.862
    eq = D.parse_equipos((fx / 'dgt_equipos.txt').read_text())
    assert eq[0] == {'prov': 'Albacete', 'road': 'A30', 'kind': 'cinturon', 'km': 57.35, 'dir': 'negative', 'equipo': 'Cinturón'}
    assert {r['kind'] for r in eq} == {'cinturon', 'stop', 'linea', 'semaforo'}
    assert D.pdf_links('<a href="/x/INFORME_CINEMOMETROS_WEB_OK_20260803_extra.pdf">a</a><a href="/x/EQUIPOS.pdf">b</a>') == {
        'informe': 'https://www.dgt.es/x/INFORME_CINEMOMETROS_WEB_OK_20260803_extra.pdf', 'equipos': 'https://www.dgt.es/x/EQUIPOS.pdf'}


def test_road_key():
    assert O.road_key('A-31') == O.road_key('A31') == 'A31'
    assert O.road_key('EX-A1') == O.road_key('EXA1')
