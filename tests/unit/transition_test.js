// Unit tests for smooth transition planning (issue #5).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { crossfadeAt, easeInOutCubic, transitionPlan } from '../../src/transition.js';
import { destinationPoint } from '../../src/geo.js';

const from = { lon: 2.35, lat: 48.85 };
const toAt = (bearing, dist) => {
  const [lon, lat] = destinationPoint(from.lon, from.lat, bearing, dist);
  return { lon, lat };
};

Deno.test('easeInOutCubic: monotone, anchored at 0/0.5/1 (no jumps → no visual break)', () => {
  assertEquals(easeInOutCubic(0), 0);
  assertAlmostEquals(easeInOutCubic(0.5), 0.5, 1e-12);
  assertEquals(easeInOutCubic(1), 1);
  let prev = -1;
  for (let t = 0; t <= 1.001; t += 0.05) {
    const v = easeInOutCubic(Math.min(1, t));
    assert(v >= prev, 'easing must be monotone');
    prev = v;
  }
});

Deno.test('transitionPlan: duration scales with distance and stays bounded', () => {
  const near = transitionPlan(from, toAt(0, 3));
  const far = transitionPlan(from, toAt(0, 25));
  const veryFar = transitionPlan(from, toAt(0, 500));
  assert(near.duration < far.duration);
  assertEquals(veryFar.duration, 1200); // clamped — never a long freeze
  assert(near.duration >= 400); // never an abrupt cut
  assertAlmostEquals(near.bearing, 0, 0.5);
  assertAlmostEquals(near.dist, 3, 0.01);
});

Deno.test('crossfade: photo always covers the screen — no gap, no white flash', () => {
  const plan = transitionPlan(from, toAt(90, 10));
  for (let e = 0; e <= 1.001; e += 0.05) {
    const { oldOpacity, newOpacity } = crossfadeAt(Math.min(1, e), plan);
    assert(oldOpacity + newOpacity >= 0.999, `coverage gap at e=${e.toFixed(2)}`);
    assert(oldOpacity >= 0 && oldOpacity <= 1);
    assert(newOpacity >= 0 && newOpacity <= 1);
  }
});

Deno.test('crossfade endpoints: starts on old sphere, ends on new sphere at scale 1', () => {
  const plan = transitionPlan(from, toAt(180, 8));
  const start = crossfadeAt(0, plan);
  const end = crossfadeAt(1, plan);
  assertEquals(start.oldOpacity, 1);
  assertEquals(start.newOpacity, 0);
  assertAlmostEquals(start.newScale, plan.zoomFrom, 1e-12);
  assertEquals(end.oldOpacity, 0);
  assertEquals(end.newOpacity, 1);
  assertAlmostEquals(end.newScale, 1, 1e-12);
});
