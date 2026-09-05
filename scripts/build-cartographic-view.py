"""Build the customer's approximate cartographic view, preserving baseline data.

Requires Shapely 2.x. Output is a presentation override, not an assertion of
international recognition or current territorial control. The supplied reference
shows entire administrative regions, not a dated battlefield/control line.
"""
import json
from pathlib import Path
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
baseline = json.loads((ROOT / 'dist/countries.json').read_text())
regions = json.loads((ROOT / 'data/cartographic-regions.geojson').read_text())
features = {f['properties']['code']: f for f in baseline['features']}
original_ru = shape(features['RUS']['geometry'])
original_ua = shape(features['UKR']['geometry'])
# A roughly kilometre-wide tolerance reconciles the two differently simplified
# source datasets. This draft is unsuitable for precise boundary measurement.
mask = unary_union([shape(f['geometry']) for f in regions['features']]).buffer(.012)
transfer = original_ua.intersection(mask)
new_ru = original_ru.union(transfer)
new_ua = original_ua.difference(transfer)
# Remove detached, sub-resolution seam fragments between the two source grids.
# Preserve the main remaining territory and separate coastal islands elsewhere.
parts = list(new_ua.geoms) if hasattr(new_ua, 'geoms') else [new_ua]
seams = [g for g in parts if g.area < .01 and g.distance(mask) < .1]
if seams:
    transfer = transfer.union(unary_union(seams))
    new_ru = original_ru.union(transfer)
    new_ua = original_ua.difference(transfer)
assert new_ru.is_valid and new_ua.is_valid
assert new_ru.intersection(new_ua).area < 1e-8
before = original_ru.union(original_ua)
after = new_ru.union(new_ua)
assert before.symmetric_difference(after).area < 1e-8, 'Changed coastlines'
for lng, lat in [(37.8,48.0),(39.3,48.57),(35.14,47.84),(32.62,46.64),(34.1,44.95),(33.53,44.6)]:
    assert new_ru.covers(Point(lng,lat)), 'Missing reference region'
for lng, lat in [(30.52,50.45),(36.23,49.99),(35.05,48.46),(30.72,46.48)]:
    assert new_ua.covers(Point(lng,lat)), 'Unexpected region change'
overrides=[]
for code, geometry in [('RUS',new_ru),('UKR',new_ua)]:
    overrides.append({'type':'Feature','properties':features[code]['properties'], 'geometry':mapping(geometry)})
output={
    'type':'FeatureCollection',
    'cartographicView':'customer-reference-rf-approximate',
    'note':'Приблизительное представление по референсу заказчика и позиции РФ. Международный статус территорий оспаривается. Не карта фактического контроля.',
    'sources':['Natural Earth 1:50m (public domain)',regions['source']],
    'license':regions['license'],
    'features':overrides,
}
(ROOT/'dist/cartography.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')))
print('PASS: valid geometries, no overlaps, unchanged combined land, reference/control points.')
print('Override bytes:', (ROOT/'dist/cartography.json').stat().st_size)
