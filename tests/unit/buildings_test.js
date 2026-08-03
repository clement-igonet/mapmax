// Unit tests for the street-mode 3D-building radius clip (#95).
import { assertEquals } from 'jsr:@std/assert@1';
import { buildingRadiusFilter, isSandboxHost, parseRadiusOverride } from '../../src/buildings.js';

Deno.test('buildingRadiusFilter: no original filter → a bare distance filter', () => {
  const f = buildingRadiusFilter(null, 2.35, 48.85, 240);
  assertEquals(f, ['<=', ['distance', { type: 'Point', coordinates: [2.35, 48.85] }], 240]);
});

Deno.test('buildingRadiusFilter: preserves the layer filter under `all`', () => {
  const orig = ['==', ['geometry-type'], 'Polygon'];
  const f = buildingRadiusFilter(orig, 1, 2, 100);
  assertEquals(f[0], 'all');
  assertEquals(f[1], orig);
  assertEquals(f[2], ['<=', ['distance', { type: 'Point', coordinates: [1, 2] }], 100]);
});

Deno.test('buildingRadiusFilter: point and radius are wired through', () => {
  const f = buildingRadiusFilter(null, -0.1278, 51.5074, 500);
  assertEquals(f[1][1], { type: 'Point', coordinates: [-0.1278, 51.5074] });
  assertEquals(f[2], 500);
});

Deno.test('buildingRadiusFilter: uses distance (not within), so tile-clipped polygons are kept', () => {
  const f = buildingRadiusFilter(null, 0, 0, 240);
  // the operator must be a <= distance comparison, never a `within`
  assertEquals(f[0], '<=');
  assertEquals(f[1][0], 'distance');
});

Deno.test('isSandboxHost: sandbox host or ?sandbox=1, never www', () => {
  const H = 'sandbox.mapmax.confinia.io';
  assertEquals(isSandboxHost('sandbox.mapmax.confinia.io', '', H), true);
  assertEquals(isSandboxHost('www.mapmax.confinia.io', '', H), false);
  assertEquals(isSandboxHost('localhost', '?sandbox=1', H), true);
  assertEquals(isSandboxHost('www.mapmax.confinia.io', '?foo=1', H), false);
});

Deno.test('parseRadiusOverride: reads ?buildingsRadius, honours 0, falls back otherwise', () => {
  assertEquals(parseRadiusOverride('?buildingsRadius=120', 50), 120);
  assertEquals(parseRadiusOverride('?a=1&buildingsRadius=75.5', 50), 75.5);
  assertEquals(parseRadiusOverride('?buildingsRadius=0', 50), 0); // 0 disables
  assertEquals(parseRadiusOverride('', 50), 50);
  assertEquals(parseRadiusOverride('?buildingsRadius=abc', 50), 50);
});
