// Unit tests for the map-mode clutter pitch cap (#41).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { farRadiusM, metersPerPixel, pitchForRadius } from '../../src/mapclutter.js';

const D = 1000; // camera-to-centre distance (px), representative
const FOV = 36.87;

Deno.test('metersPerPixel matches web-mercator 512-tile resolution (validated vs unproject)', () => {
  // Paris, z16.5 — measured ~0.5550 m/px against map.unproject in the browser.
  assertAlmostEquals(metersPerPixel(48.855, 16.5), 0.5557, 0.01);
  // Equator z0: full 512-px world spans the 40 075 km circumference.
  assertAlmostEquals(metersPerPixel(0, 0), 78271.517, 1);
});

Deno.test('farRadiusM grows with pitch and blows up at the horizon', () => {
  const r10 = farRadiusM(10, D, 5, FOV);
  const r40 = farRadiusM(40, D, 5, FOV);
  const r60 = farRadiusM(60, D, 5, FOV);
  assert(r10 < r40 && r40 < r60, 'far radius must increase with pitch');
  // top edge = pitch + fov/2; at pitch 72 that is > 90° → looks past the horizon.
  assertEquals(farRadiusM(72, D, 5, FOV), Infinity);
});

Deno.test('farRadiusM shrinks as you zoom in (more px per metre)', () => {
  const zoomedOut = farRadiusM(50, D, 2, FOV);
  const zoomedIn = farRadiusM(50, D, 20, FOV);
  assert(zoomedIn < zoomedOut, 'same pitch covers fewer metres when zoomed in');
});

Deno.test('pitchForRadius: the chosen pitch stays within the radius', () => {
  const R = 160;
  const p = pitchForRadius(D, 5, FOV, R, 85, 20);
  assert(p > 20 && p < 85, `expected an interior cap, got ${p}`);
  assert(farRadiusM(p, D, 5, FOV) <= R + 1, 'far radius must not exceed R');
});

Deno.test('pitchForRadius: zooming in unlocks more tilt', () => {
  const out = pitchForRadius(D, 3, FOV, 160, 85, 20);
  const inn = pitchForRadius(D, 30, FOV, 160, 85, 20);
  assert(inn > out, 'more px per metre ⇒ higher allowed pitch');
});

Deno.test('pitchForRadius: a huge radius stops just below the horizon, tiny radius hits the floor', () => {
  // With a 36.87° FOV the top edge reaches the horizon at pitch 90 − fov/2 ≈
  // 71.5°; beyond that the map sees to infinity, so the cap can never exceed it
  // however large the radius — exactly what "don't render to the horizon" wants.
  const horizon = 90 - FOV / 2;
  const huge = pitchForRadius(D, 5, FOV, 1e9, 85, 20);
  assert(huge < horizon && huge > horizon - 1, `expected ~${horizon}°, got ${huge}`);
  assert(Number.isFinite(farRadiusM(huge, D, 5, FOV)), 'far radius at the cap must be finite');
  assertEquals(pitchForRadius(D, 5, FOV, 1e-6, 85, 20), 20); // clamped to minCap
});

Deno.test('pitchForRadius: degenerate transform falls back to the hard max', () => {
  assertEquals(pitchForRadius(0, 5, FOV, 160, 85, 20), 85);
  assertEquals(pitchForRadius(D, 0, FOV, 160, 85, 20), 85);
});
