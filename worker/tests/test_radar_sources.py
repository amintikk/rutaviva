import io

from rutaviva import local_radars as L
from rutaviva import radar_sources as R
from rutaviva.sources import Sources


def test_utm_to_lonlat():
    lon, lat = R.utm_to_lonlat(431016.9542, 4590851.6618)  # C-58, Barcelona
    assert abs(lon - 2.17392) < 1e-4 and abs(lat - 41.46630) < 1e-4


SCT_FIXED = """(ETRS89)

Via         PK          Velocitat   X           Y
A-2         445,35      120         288075,4643 4601625,063
A-2         501,5-506,5 120         3401992,722 4612186,153
A-2         563,2-570,1 80          392583,63   398125,43
B-10        18,5        80          42552972    457695385
B-10        18,5        80          42552972    457695385
C-32 nord   85          120         441144,0836 4592656,0677
C-1412a     19,3        90          378000,0    4633000,0
N-2         709,5-713,8 90          483604,6249 4642138,3423
"""

SCT_TRAILER = "Via\tPK\tVelocitat\tX\tY\r\nAP-7\t60,77\t120\t482294,3992\t4648510,672\r\nN-II\t687,75\t80\t479196,8094\t4621500,278\r\n"


def test_parse_sct_fixed_width():
    rows, bad = R.parse_sct(SCT_FIXED, 'fijo')
    assert not bad
    assert len(rows) == 7  # the repeated B-10 line counts once
    a2 = rows[0]
    assert a2['road'] == 'A-2' and a2['km'] == 445.35 and a2['maxspeed'] == 120 and a2['kind'] == 'fijo'
    assert a2['cands'] and not a2['cands'][0][2]
    section = rows[1]
    assert section['kind'] == 'tramo' and section['km2'] == 506.5
    assert section['cands'] and all(c[2] for c in section['cands'])  # only repaired guesses
    assert rows[2]['cands'] == []  # Y without a digit: nothing plausible
    assert rows[3]['cands'] and rows[3]['cands'][0][2]  # missing decimal commas, repaired
    assert rows[4]['road'] == 'C-32' and rows[4]['note'] == 'nord'
    assert rows[5]['road'] == 'C-1412a'
    assert rows[6]['road'] == 'N-II'  # as in OpenStreetMap


def test_parse_sct_trailers():
    rows, bad = R.parse_sct(SCT_TRAILER, 'remolque')
    assert not bad and [r['kind'] for r in rows] == ['remolque', 'remolque']
    assert rows[1]['road'] == 'N-II' and rows[1]['cands']


def test_speed_check():
    assert R.speed_check(['CONTROL', 'MOVIL', 'DE VELOCIDAD'], ['E17', 'R301120I']) == {'kind': 'movil', 'limit': 120, 'ahead': None}
    assert R.speed_check(['CONTROL', 'MOBIL DE', 'VELOCIDADE'], [])['kind'] == 'movil'
    assert R.speed_check(['VELOCIDAD CONTROLADA', 'EN TRAMO'], ['E17'])['kind'] == 'tramo'
    assert R.speed_check(['A 2 KM', 'RADAR', 'DE TRAMO'], [])['ahead'] == 2
    assert R.speed_check(['A 500 M VELOCIDAD CONTROLADA POR RADAR'], [])['ahead'] == 0.5
    assert R.speed_check(['EN H-31 A 3 KM', 'CNTROL VELOCIDAD', 'POR RADAR'], ['R301100'])['limit'] == 100
    assert R.speed_check(['CON LLUVIA', 'MODERE', 'VELOCIDAD'], ['P29']) is None
    assert R.speed_check([], ['E17'])['kind'] == 'radar'


def test_parse_madrid():
    csv = ('﻿Nº RADAR;Ubicacion;Carretara o vial;UBICACIÓN Calle 30;PK;Sentido;Tipo;Carril;Longitud inicio tramo;'
           'Latitud inicio tramo;X (WGS84);Y (WGS84);Longitud;Latitud;Velocidad límite;Responsable\n'
           '1;M-30, ENTRADA DE LA A-1;M-30;00NC50;0+500;Calzada interior;Fijo;Fijo carril 4;;;442843.00;4481180.00;-3.67433808;40.47934148;90;DGP\n'
           '29;A-5 PK 5+750;A5;;;Salida;Radar de tramo;Salida;-3.7457;40.4072;;;-3.7635;40.4001;70;DGGVC\n')
    rows = R.parse_madrid(csv.encode('utf-8'))
    assert rows[0]['kind'] == 'fijo' and rows[0]['maxspeed'] == 90
    assert rows[1]['kind'] == 'tramo' and (rows[1]['lon'], rows[1]['lat']) == (-3.7457, 40.4072) and rows[1]['end'] == (-3.7635, 40.4001)


def test_leon_list():
    text = """León, 30 de octubre de 2026
    ... la ubicación de los radares móviles durante el mes de noviembre de 2026 en horario de mañana y tarde
     Día   Turno     Lugar                          Velocidad máxima de la vía Km/h
      1    mañana    Alcalde Miguel Castaño          30
                     Avda. Universidad               50
           tarde     Fraga Iribarne                  30
      2    mañana    Principal (Oteruelo)            30
    """
    year, month, rows = L.parse_leon(text)
    assert (year, month) == (2026, 11)
    assert [(r['day'], r['shift'], r['street'], r['maxspeed']) for r in rows] == [
        (1, 'mañana', 'Alcalde Miguel Castaño', 30), (1, 'mañana', 'Avda. Universidad', 50),
        (1, 'tarde', 'Fraga Iribarne', 30), (2, 'mañana', 'Principal', 30)]
    assert rows[-1]['where'] == 'Oteruelo'
    assert L.leon_pdf('<a href="/es/actualidad/noticias/articulos/SiteAssets/Lists/EntradasDeBlog/Noticias2/30102026 Radares mes.pdf">') \
        == 'https://aytoleon.es/es/actualidad/noticias/articulos/SiteAssets/Lists/EntradasDeBlog/Noticias2/30102026%20Radares%20mes.pdf'


def test_street_names():
    assert L.madrid_street('N034 ALFONSO XII') == 'Alfonso XII'
    assert L.madrid_street('N016 AV RAMON Y CAJAL') == 'Avenida Ramon y Cajal'
    assert L.madrid_street('01,3 M-23 HACIA M30') == 'M-23'
    assert L.expand('P.º Condesa') == 'Paseo Condesa'
    assert L.core('Calle de Alfonso XII') == L.core('ALFONSO XII') == 'alfonso xii'


def test_donostia():
    js = '''function addLocalizaciones() {
	var puntos = {
    "name" : "Ubicaciones",
    "type" : "FeatureCollection",
    "features" : [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[1.98, 43.31], [1.99, 43.31]]},
      "attributes": {"tituloCas": "Paseo de Francia", "tituloEus": "Frantzia pasealekua"}}]
};
	var pruebas = [];'''.encode('latin-1')
    items = L.parse_donostia(js)
    assert items == [{'title': 'Paseo de Francia', 'title_eu': 'Frantzia pasealekua', 'lines': [[(1.98, 43.31), (1.99, 43.31)]]}]
    empty = b'var puntos = {\n "name" : "Ubicaciones",\n "type" : "FeatureCollection",\n "features" : []\n};\n'
    assert L.parse_donostia(empty) == []


BCN_HEAD = 'Data_Infraccio,Hora_Infraccio,Codi_Carrer,Nom_Carrer,Num_Carrer,Longitud_WGS84,Latitud_WGS84,Infraccio_Codi\n'


def test_bcn_recurring():
    rows = []
    # A fixed camera: fines every day, all day long.
    for d in range(1, 31):
        for h in (1, 9, 17, 23):
            rows.append(f'2025-10-{d:02d},{h:02d}0000,1,Ronda,1,2.1,41.4,1211')
    # A mobile spot: two mornings, a dozen fines each within an hour.
    for d in (3, 17):
        for m in range(0, 60, 5):
            rows.append(f'2025-10-{d:02d},09{m:02d}00,2,Carrer Gran,10,2.2,41.41,1214')
    # Not speeding.
    rows.append('2025-10-05,100000,3,Plaça,1,2.3,41.42,700')
    spots, info = L.bcn_recurring(io.StringIO(BCN_HEAD + '\n'.join(rows)))
    assert info['from'] == '2025-10-01' and info['to'] == '2025-10-30'
    assert [s['street'] for s in spots] == ['Carrer Gran']
    assert spots[0]['days'] == 2 and spots[0]['fines'] == 24 and spots[0]['hours'] == [9]


def test_madrid_recurring():
    head = 'CALIFICACION;LUGAR;MES;ANIO;HORA;IMP_BOL;DESCUENTO; PUNTOS;DENUNCIANTE;HECHO-BOL;VEL_LIMITE;VEL_CIRCULA ;COORDENADA-X;COORDENADA-Y\n'
    rows = [f'GRAVE;N034 ALFONSO XII;06;2026;08.{m:02d};100;SI;0;MOVILIDAD RADAR;SOBREPASAR;50;71;;\x00' for m in range(10)]
    rows += [f'GRAVE;F001 TODO EL DIA;06;2026;{h:02d}.10;100;SI;0;MOVILIDAD RADAR;SOBREPASAR;50;71;;' for h in range(0, 24, 2)]
    rows += ['GRAVE;CALLE 30 KM 10XC30;06;2026;00.37;500;SI;6;POLICIA MUNICIPAL;SOBREPASAR;70;132;;']
    spots, info = L.madrid_recurring(io.StringIO(head + '\n'.join(rows)))
    assert info['month'] == '2026-06'
    assert [(s['street'], s['fines'], s['hours']) for s in spots] == [('Alfonso XII', 10, [8])]


def test_circles():
    g = L.circles([[(2.0, 41.0), (2.01, 41.0)]], r_km=0.15, step_km=0.25)
    assert g['type'] == 'MultiPolygon' and 3 <= len(g['coordinates']) <= 5
    ring = g['coordinates'][0][0]
    assert ring[0] == ring[-1]


def test_source_status(tmp_path, monkeypatch):
    from rutaviva import sources as S
    monkeypatch.setattr(S, 'read_json', lambda *a, **k: None)
    monkeypatch.setattr(S, 'write_json', lambda *a, **k: 0)
    src = Sources()
    assert src.status('sct_fijos')['status'] == 'falta'
    src.ok('sct_fijos', count=200, data_date='2026-09-17T08:21:58Z')
    assert src.status('sct_fijos')['status'] == 'ok'
    src.ok('nap_radares', count=700, data_date='2025-01-01T00:00:00Z')
    assert src.status('nap_radares')['status'] == 'obsoleta'
    src.state['sct_fijos']['fetched'] = '2026-01-01T00:00:00Z'
    assert src.status('sct_fijos')['status'] == 'obsoleta'
    src.ok('donostia', count=0)
    assert src.status('donostia')['status'] == 'ok'  # no radar today is a valid answer
    assert src.status('euskadi_navarra')['status'] == 'falta'
