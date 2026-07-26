// Unit tests for style hardening (issue #14).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { hardenStyle, NULLABLE_NUMERIC_DEFAULTS, transparentPixel } from '../../src/stylefix.js';

Deno.test('transparent placeholder is a valid 1x1 RGBA image', () => {
  const px = transparentPixel();
  assertEquals(px.width, 1);
  assertEquals(px.height, 1);
  assertEquals(px.data.length, 4);
  assertEquals([...px.data], [0, 0, 0, 0]);
});

Deno.test('hardenStyle wraps standalone nullable numeric value gets (fill-extrusion)', () => {
  const hardened = hardenStyle({
    layers: [
      { id: 'b', type: 'fill-extrusion', paint: { 'fill-extrusion-height': ['get', 'render_height'] } },
    ],
  });
  assertEquals(hardened.layers[0].paint['fill-extrusion-height'], [
    'coalesce', ['get', 'render_height'], NULLABLE_NUMERIC_DEFAULTS.render_height,
  ]);
});

Deno.test('hardenStyle guards any get operand of an ordering comparison (rank, admin_level, ref_length)', () => {
  const hardened = hardenStyle({
    layers: [
      { id: 'poi', type: 'symbol', filter: ['<=', ['get', 'rank'], 3] },
      { id: 'bnd', type: 'line', filter: ['all', ['<=', ['get', 'admin_level'], 2]] },
      { id: 'shield', type: 'symbol', filter: ['>=', ['get', 'ref_length'], 6] },
    ],
  });
  assertEquals(hardened.layers[0].filter, ['<=', ['coalesce', ['get', 'rank'], 0], 3]);
  assertEquals(hardened.layers[1].filter, ['all', ['<=', ['coalesce', ['get', 'admin_level'], 0], 2]]);
  assertEquals(hardened.layers[2].filter, ['>=', ['coalesce', ['get', 'ref_length'], 0], 6]);
});

Deno.test('hardenStyle leaves equality gets, string gets and literals alone', () => {
  const hardened = hardenStyle({
    layers: [{
      id: 'x',
      filter: ['==', ['get', 'class'], 'motorway'],
      paint: { 'text-field': ['get', 'name'], 'text-size': 12 },
    }],
  });
  assertEquals(hardened.layers[0].filter, ['==', ['get', 'class'], 'motorway']);
  assertEquals(hardened.layers[0].paint['text-field'], ['get', 'name']);
  assertEquals(hardened.layers[0].paint['text-size'], 12);
});

Deno.test('hardenStyle is idempotent (no double-wrapping)', () => {
  const once = hardenStyle({ f: ['<=', ['get', 'rank'], 3], h: ['get', 'render_height'] });
  const twice = hardenStyle(once);
  assertEquals(twice, once);
});

Deno.test('hardenStyle leaves no bare get inside any ordering comparison of the real style', async () => {
  const style = JSON.parse(
    await Deno.readTextFile(new URL('../fixtures/liberty-min.json', import.meta.url))
  );
  const hardened = hardenStyle(style);
  // Recursively assert: no ordering op has a bare ["get", …] operand.
  let violations = 0;
  const scan = (n) => {
    if (Array.isArray(n)) {
      if (['<', '<=', '>', '>='].includes(n[0])) {
        for (const c of n.slice(1)) {
          if (Array.isArray(c) && c[0] === 'get') violations++;
        }
      }
      n.forEach(scan);
    } else if (n && typeof n === 'object') {
      Object.values(n).forEach(scan);
    }
  };
  scan(hardened);
  assertEquals(violations, 0, `${violations} unguarded ordering-comparison gets remain`);
});
