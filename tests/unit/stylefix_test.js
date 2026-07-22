// Unit tests for style hardening (issue #14).
import { assertEquals } from 'jsr:@std/assert@1';
import { buildingBaseExpr, buildingHeightExpr, transparentPixel } from '../../src/stylefix.js';

Deno.test('building height/base expressions coalesce null tags to numbers', () => {
  assertEquals(buildingHeightExpr(), ['coalesce', ['get', 'render_height'], 6]);
  assertEquals(buildingHeightExpr(10), ['coalesce', ['get', 'render_height'], 10]);
  assertEquals(buildingBaseExpr(), ['coalesce', ['get', 'render_min_height'], 0]);
});

Deno.test('transparent placeholder is a valid 1x1 RGBA image', () => {
  const px = transparentPixel();
  assertEquals(px.width, 1);
  assertEquals(px.height, 1);
  assertEquals(px.data.length, 4);
  assertEquals([...px.data], [0, 0, 0, 0]); // fully transparent
});
