// Unit tests for pure geometry helpers (issues #3, #4).
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import {
  angularDiff,
  bearingBetween,
  cameraAnglesFor,
  clamp,
  destinationPoint,
  distanceM,
  sphereYawForHeading,
  zoomForEyeHeight,
} from '../../src/geo.js';

Deno.test('clamp bounds values', () => {
  assertEquals(clamp(5, 0, 10), 5);
  assertEquals(clamp(-1, 0, 10), 0);
  assertEquals(clamp(99, 0, 10), 10);
});

Deno.test('zoomForEyeHeight: ~1.7 m eye height in Paris is around z21.8 (#3 human sight)', () => {
  const z = zoomForEyeHeight(900, 36.87, 48.85, 85, 1.7);
  assertAlmostEquals(z, 21.77, 0.05);
});

Deno.test('zoomForEyeHeight: higher eye means lower zoom', () => {
  const z17 = zoomForEyeHeight(900, 36.87, 48.85, 85, 1.7);
  const z50 = zoomForEyeHeight(900, 36.87, 48.85, 85, 50);
  if (!(z50 < z17)) throw new Error(`expected ${z50} < ${z17}`);
});

Deno.test('sphereYawForHeading: north-facing image center at -PI/2', () => {
  assertAlmostEquals(sphereYawForHeading(0), -Math.PI / 2, 1e-12);
  assertAlmostEquals(sphereYawForHeading(90), -Math.PI, 1e-12);
  assertAlmostEquals(sphereYawForHeading(0, 0.1), -Math.PI / 2 + 0.1, 1e-12);
});

Deno.test('cameraAnglesFor: bearing 0 pitch 90 is straight ahead', () => {
  const { yaw, pitch } = cameraAnglesFor(0, 90);
  assertAlmostEquals(yaw, 0, 1e-12);
  assertAlmostEquals(pitch, 0, 1e-12);
  // top-down map view looks straight down
  assertAlmostEquals(cameraAnglesFor(0, 0).pitch, -Math.PI / 2, 1e-12);
});

Deno.test('bearingBetween: cardinal directions', () => {
  assertAlmostEquals(bearingBetween(2.35, 48.85, 2.35, 48.86), 0, 0.01);
  assertAlmostEquals(bearingBetween(2.35, 48.85, 2.36, 48.85), 90, 0.01);
});

Deno.test('distanceM: one degree of latitude', () => {
  assertAlmostEquals(distanceM(0, 0, 0, 1), 111195, 30);
});

Deno.test('destinationPoint round-trips with bearing and distance', () => {
  const [lon, lat] = destinationPoint(2.35, 48.85, 37, 100);
  assertAlmostEquals(distanceM(2.35, 48.85, lon, lat), 100, 0.01);
  assertAlmostEquals(bearingBetween(2.35, 48.85, lon, lat), 37, 0.01);
});

Deno.test('angularDiff: wraps across north', () => {
  assertAlmostEquals(angularDiff(350, 10), -20, 1e-9);
  assertAlmostEquals(angularDiff(10, 350), 20, 1e-9);
  assertAlmostEquals(angularDiff(180, 0), 180, 1e-9);
});
