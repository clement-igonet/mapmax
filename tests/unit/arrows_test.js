// Unit tests for navigation arrow selection (issue #4).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { arrowGlyphPoints, arrowsToGeoJSON, pickArrows } from '../../src/arrows.js';
import { destinationPoint, distanceM } from '../../src/geo.js';

const cur = { id: 'me', lon: 2.35, lat: 48.85, sequenceId: 'seq-A' };
const at = (id, bearing, dist, sequenceId = 'seq-A') => {
  const [lon, lat] = destinationPoint(cur.lon, cur.lat, bearing, dist);
  return { id, lon, lat, sequenceId };
};

Deno.test('pickArrows: one arrow per direction, nearest wins', () => {
  const arrows = pickArrows(cur, [
    at('north-near', 0, 5),
    at('north-far', 5, 12), // same sector as north-near → dropped
    at('south', 180, 8),
    at('east', 90, 15, 'seq-B'),
  ]);
  assertEquals(arrows.map((a) => a.targetId).sort(), ['east', 'north-near', 'south']);
  const north = arrows.find((a) => a.targetId === 'north-near');
  assertAlmostEquals(north.bearing, 0, 0.5);
  assertEquals(north.sameSequence, true);
  assertEquals(arrows.find((a) => a.targetId === 'east').sameSequence, false);
});

Deno.test('pickArrows: filters self, near-duplicates and far pictures', () => {
  const arrows = pickArrows(cur, [
    { ...cur }, // self
    at('dup', 10, 0.5), // < minDist
    at('too-far', 45, 200), // > maxDist
    at('ok', 270, 10),
  ]);
  assertEquals(arrows.map((a) => a.targetId), ['ok']);
});

Deno.test('pickArrows: arrow lies on the ground toward the target, near the camera', () => {
  const [a] = pickArrows(cur, [at('t', 37, 20)]);
  const d = distanceM(cur.lon, cur.lat, a.lon, a.lat);
  assertAlmostEquals(d, 5.5, 0.05); // ARROW_DEFAULTS.arrowDist
  assert(d < a.dist, 'arrow must be closer than the target');
});

Deno.test('pickArrows: close target pulls the arrow closer than default', () => {
  const [a] = pickArrows(cur, [at('t', 90, 4)]);
  assertAlmostEquals(distanceM(cur.lon, cur.lat, a.lon, a.lat), 2.4, 0.05);
});

Deno.test('arrowGlyphPoints stay within the padded box (never clipped) — #26', () => {
  for (const [size, pad] of [[128, 14], [96, 10], [64, 8]]) {
    for (const [x, y] of arrowGlyphPoints(size, pad)) {
      assert(x >= pad - 1e-9 && x <= size - pad + 1e-9, `x ${x} out of [${pad}, ${size - pad}]`);
      assert(y >= pad - 1e-9 && y <= size - pad + 1e-9, `y ${y} out of [${pad}, ${size - pad}]`);
    }
  }
});

Deno.test('arrowGlyphPoints: chevron is centered and points up', () => {
  const [tip, right, notch, left] = arrowGlyphPoints(128, 14);
  assertEquals(tip[0], 64); // centered horizontally
  assert(tip[1] < notch[1], 'tip above the notch (points up)');
  assertEquals(left[0], 128 - right[0]); // symmetric wings
  assertEquals(left[1], right[1]);
});

Deno.test('arrowsToGeoJSON emits clickable features', () => {
  const fc = arrowsToGeoJSON(pickArrows(cur, [at('t', 0, 10)]));
  assertEquals(fc.type, 'FeatureCollection');
  assertEquals(fc.features[0].properties.targetId, 't');
  assertEquals(typeof fc.features[0].properties.bearing, 'number');
});
