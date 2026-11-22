import datetime as dt

from rutaviva import fires as FI
from rutaviva.osm import simplify

CSV = b"""latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
40.40000,-3.70000,330,0.4,0.4,2026-11-21,0130,N20,nominal,2.0NRT,280,12.5,N
40.40500,-3.70500,331,0.4,0.4,2026-11-21,1300,N20,high,2.0NRT,280,3.5,D
40.40000,-3.70000,331,0.4,0.4,2026-11-21,1300,N20,low,2.0NRT,280,9,D
38.70000,-9.10000,330,0.4,0.4,2026-11-21,0130,N20,nominal,2.0NRT,280,40,N
"""

GML = b"""<wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml" xmlns:ms="m"><gml:featureMember>
<ms:x><ms:msGeometry><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList srsDimension="2">40.0 -6.0 40.0 -5.9 40.1 -5.9 40.0 -6.0</gml:posList>
</gml:LinearRing></gml:exterior></gml:Polygon></ms:msGeometry><ms:id>7</ms:id><ms:FIREDATE>2026-11-02 13:42:00</ms:FIREDATE>
<ms:COUNTRY>ES</ms:COUNTRY><ms:PROVINCE>Zamora</ms:PROVINCE><ms:COMMUNE>Rabanales</ms:COMMUNE><ms:AREA_HA>12</ms:AREA_HA></ms:x>
</gml:featureMember><gml:featureMember><ms:x><gml:posList>38 -9 38 -8.9 38.1 -8.9 38 -9</gml:posList><ms:COUNTRY>PT</ms:COUNTRY></ms:x></gml:featureMember>
</wfs:FeatureCollection>"""


def test_hotspots_keep_spain_and_merge_nearby():
    spots = FI.hotspots({'NOAA-20': CSV})
    assert len(spots) == 2  # low confidence and Portugal dropped
    groups = FI.cluster(spots)
    assert len(groups) == 1 and groups[0]['n'] == 2 and groups[0]['frp'] == 16.0
    assert groups[0]['first'] == '2026-11-21T01:30:00Z' and groups[0]['last'] == '2026-11-21T13:00:00Z'


def test_persistent_spots_are_flagged():
    today = dt.date(2026, 11, 22)
    spots = [{'lon': -5.73, 'lat': 43.53, 'when': f'2026-11-{d:02d}T01:00:00Z', 'frp': 4} for d in range(15, 22)]
    hist = FI.record(spots, {'0:0': ['2020-01-01']}, today)
    assert '0:0' not in hist  # older than 60 days
    groups = FI.cluster(spots[-1:])
    FI.mark_persistent(groups, hist)
    assert groups[0]['persistent'] and groups[0]['days'] == 7


def test_spain_outline():
    assert FI.in_spain(-3.7, 40.4) and FI.in_spain(2.82, 41.98) and FI.in_spain(-15.4, 28.1) and FI.in_spain(-6.97, 38.88)
    assert not FI.in_spain(-9.1, 38.7) and not FI.in_spain(1.44, 43.6) and not FI.in_spain(-5.6, 35.77)


def test_burnt_areas_spain_only_lon_lat_order():
    areas = FI.burnt(GML)
    assert len(areas) == 1
    a = areas[0]
    assert a['rings'][0][0] == [-6.0, 40.0] and a['area'] == 12 and a['place'] == 'Rabanales, Zamora' and a['date'] == '2026-11-02'


def test_simplify_keeps_ends_and_corners():
    line = [(0, 0), (0.5, 0.00001), (1, 0), (1, 1)]
    assert simplify(line, 0.0002) == [[0, 0], [1, 0], [1, 1]]
