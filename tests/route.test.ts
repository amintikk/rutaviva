import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Corridor, decode } from '../src/ui/route.ts';

test('decodes a Valhalla polyline6', () => {
  // Encoded with precision 6: (lat 38.5, lon -120.2), (40.7, -120.95), (43.252, -126.453)
  const pts = decode('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI');
  assert.deepEqual(pts.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test('corridor measures distance to and along a route', () => {
  // A straight east-west line of ~8.5 km at 40ºN.
  const c = new Corridor([[-3.8, 40.0], [-3.7, 40.0]]);
  const near = c.measure([-3.75, 40.001], 500)!;
  assert.ok(near[0] > 100 && near[0] < 120, `offset ${near[0]}`);
  assert.ok(Math.abs(near[1] - 4264) < 60, `along ${near[1]}`);
  assert.equal(c.measure([-3.75, 40.05], 500), null);
});
