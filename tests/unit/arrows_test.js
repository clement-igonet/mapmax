// Unit tests for navigation arrow selection (issue #4).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { arrowsToGeoJSON, groundArrowPolygon, pickArrows } from '../../src/arrows.js';
import { angularDiff, bearingBetween, destinationPoint, distanceM } from '../../src/geo.js';

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

// #55: real-world case (picture adc7432f, heading 221°, GPS ±4 m). The neighbours
// are jittered off the street; the forward arrow must snap to the heading (221°)
// and target the best-aligned neighbour, not the closer but off-axis one.
Deno.test('pickArrows: forward/back arrows snap to the travel heading (#55)', () => {
  const cam = { id: 'me', lon: 2.35, lat: 48.85, sequenceId: 'A', heading: 221 };
  const arrows = pickArrows(cam, [
    at('fwd-true', 226, 3), // down the street, a touch off
    at('fwd-jitter', 257, 1.4), // closer, but 36° off the street — must NOT win
    at('fwd-left', 202, 3),
    at('back', 41, 4), // opposite travel direction (heading + 180)
  ]);
  const fwd = arrows.find((a) => Math.abs(angularDiff(a.bearing, 221)) < 1);
  assert(fwd, 'a forward arrow is drawn along the heading');
  assertAlmostEquals(fwd.bearing, 221, 0.5); // drawn on the axis, not the GPS bearing
  assertEquals(fwd.targetId, 'fwd-true'); // aligned neighbour beats the jittered-closer one
  const back = arrows.find((a) => Math.abs(angularDiff(a.bearing, 41)) < 1);
  assert(back && back.targetId === 'back', 'a back arrow snaps to heading+180');
});

Deno.test('pickArrows: with no heading, falls back to per-sector GPS bearings', () => {
  const cam = { id: 'me', lon: 2.35, lat: 48.85, sequenceId: 'A' }; // no heading
  const [a] = pickArrows(cam, [at('t', 137, 8)]);
  assertAlmostEquals(a.bearing, 137, 0.5); // unchanged behaviour when heading absent
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

Deno.test('pickArrows: far target → arrow at arrowDist toward it', () => {
  const [a] = pickArrows(cur, [at('t', 37, 20)]);
  const d = distanceM(cur.lon, cur.lat, a.lon, a.lat);
  assertAlmostEquals(d, 9, 0.05); // ARROW_DEFAULTS.arrowDist
  assert(d < a.dist, 'arrow must be closer than a far target');
});

Deno.test('pickArrows: close target → arrow kept at minArrowDist (never right on the camera) #26', () => {
  const [a] = pickArrows(cur, [at('t', 90, 3)]); // neighbour only 3 m away
  assertAlmostEquals(distanceM(cur.lon, cur.lat, a.lon, a.lat), 6, 0.05); // minArrowDist
});

// Automated crop guard: with the camera at the picture, no arrow polygon vertex
// may come within ~4 m — closer than that a foreshortened ground polygon crosses
// the near plane and gets clipped (the "cropped arrow"). Uses the same 1.4 scale
// as the renderer (navigation.js).
Deno.test('pickArrows + groundArrowPolygon: no arrow vertex near the camera (no crop) #26', () => {
  const cam = { id: 'me', lon: 2.35, lat: 48.85, sequenceId: 'A' };
  const dense = [at('n2', 0, 2), at('n3', 95, 3), at('n4', 185, 4), at('n25', 270, 25)];
  const arrows = pickArrows(cam, dense);
  assert(arrows.length >= 3, 'expected several arrows');
  for (const a of arrows) {
    for (const [lon, lat] of groundArrowPolygon(a.lon, a.lat, a.bearing, 1.4)[0]) {
      const d = distanceM(cam.lon, cam.lat, lon, lat);
      assert(d >= 4, `arrow vertex ${d.toFixed(1)} m from camera — would be near-plane-clipped`);
    }
  }
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

Deno.test('fairMixBySource: a dense source cannot crowd out the others (#112)', async () => {
  const { fairMixBySource } = await import('../../src/arrows.js');
  // 20 close 'a' dots, 3 far 'b' dots — pure nearest-12 would show zero 'b'.
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, source: 'a', dist: i + 1 })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, source: 'b', dist: 40 + i })),
  ];
  const mix = fairMixBySource(items, 12);
  const bs = mix.filter((p) => p.source === 'b');
  if (bs.length !== 3) throw new Error(`expected the 3 'b' dots reserved, got ${bs.length}`);
  if (mix.length !== 12) throw new Error(`cap not honored: ${mix.length}`);
  for (let i = 1; i < mix.length; i++) if (mix[i].dist < mix[i - 1].dist) throw new Error('not nearest-first');
  // Single source: behaves exactly like nearest-N.
  const solo = fairMixBySource(items.filter((p) => p.source === 'a'), 5);
  if (solo.map((p) => p.id).join() !== 'a0,a1,a2,a3,a4') throw new Error('single-source order broken');
});
