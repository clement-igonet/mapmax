// Unit tests for navigation arrow selection (issue #4).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { arrowsToGeoJSON, groundArrowPolygon, pickArrows } from '../../src/arrows.js';
import { bearingBetween, destinationPoint, distanceM } from '../../src/geo.js';

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

Deno.test('groundArrowPolygon: real ground geometry, closed ring, tip points along bearing (#26)', () => {
  const poly = groundArrowPolygon(2.35, 48.85, 37, 1);
  assertEquals(poly.length, 1); // one ring
  const ring = poly[0];
  assertEquals(ring.length, 8); // 7 shape points + closing point
  assertEquals(ring[0], ring[ring.length - 1], 'ring must be closed');
  // tip (first vertex) lies along the bearing from the anchor
  assertAlmostEquals(bearingBetween(2.35, 48.85, ring[0][0], ring[0][1]), 37, 0.5);
  // every vertex is within a few metres of the anchor (a small ground arrow)
  for (const [lon, lat] of ring) {
    assert(distanceM(2.35, 48.85, lon, lat) <= 2.3, 'arrow vertex too far from anchor');
  }
});

Deno.test('groundArrowPolygon: scale grows the arrow', () => {
  const near = groundArrowPolygon(2.35, 48.85, 0, 1)[0][0];
  const far = groundArrowPolygon(2.35, 48.85, 0, 2)[0][0];
  assert(distanceM(2.35, 48.85, far[0], far[1]) > distanceM(2.35, 48.85, near[0], near[1]));
});

Deno.test('arrowsToGeoJSON emits clickable ground polygons', () => {
  const fc = arrowsToGeoJSON(pickArrows(cur, [at('t', 0, 10)]));
  assertEquals(fc.type, 'FeatureCollection');
  assertEquals(fc.features[0].geometry.type, 'Polygon');
  assertEquals(fc.features[0].properties.targetId, 't');
  assertEquals(typeof fc.features[0].properties.bearing, 'number');
});
