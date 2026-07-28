// Unit tests for the near-building bubble geometry (#60).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildingsWithinRadius, nearestVertexDistanceM } from '../../src/nearbuildings.js';
import { destinationPoint } from '../../src/geo.js';

const O = [2.35, 48.85]; // reference point

// A tiny square building polygon centred `distM` metres north of O.
function squareAt(distM, id) {
  const [clng, clat] = destinationPoint(O[0], O[1], 0, distM);
  const d = 0.00005; // ~5 m half-size
  return {
    id,
    geometry: { type: 'Polygon', coordinates: [[
      [clng - d, clat - d], [clng + d, clat - d], [clng + d, clat + d], [clng - d, clat + d], [clng - d, clat - d],
    ]] },
    properties: { render_height: 12, render_min_height: 0 },
  };
}

Deno.test('nearestVertexDistanceM: nearest polygon vertex wins', () => {
  const b = squareAt(20);
  const d = nearestVertexDistanceM(b.geometry, O[0], O[1]);
  assert(d > 10 && d < 20, `expected ~15 m to nearest corner, got ${d}`);
});

Deno.test('buildingsWithinRadius: keeps near, drops far', () => {
  const fc = buildingsWithinRadius([squareAt(10, 'a'), squareAt(80, 'b'), squareAt(30, 'c')], O[0], O[1], 50);
  assertEquals(fc.type, 'FeatureCollection');
  assertEquals(fc.features.map((f) => f.properties.render_height), [12, 12]); // a + c kept, b dropped
  assertEquals(fc.features.length, 2);
});

Deno.test('buildingsWithinRadius: de-duplicates by feature id', () => {
  const a = squareAt(10, 'dup');
  const fc = buildingsWithinRadius([a, { ...a }], O[0], O[1], 50);
  assertEquals(fc.features.length, 1);
});

Deno.test('buildingsWithinRadius: carries height, defaults when missing', () => {
  const b = squareAt(10, 'x');
  delete b.properties.render_height;
  delete b.properties.render_min_height;
  const [f] = buildingsWithinRadius([b], O[0], O[1], 50).features;
  assertEquals(f.properties.render_height, 6); // default
  assertEquals(f.properties.render_min_height, 0);
});

Deno.test('buildingsWithinRadius: radius is customizable', () => {
  const list = [squareAt(30, 'a')];
  assertEquals(buildingsWithinRadius(list, O[0], O[1], 20).features.length, 0); // outside 20 m
  assertEquals(buildingsWithinRadius(list, O[0], O[1], 50).features.length, 1); // inside 50 m
});
