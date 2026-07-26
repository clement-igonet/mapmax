// Unit tests for the vector/photo blend mapping (#6).
import { assertEquals } from 'jsr:@std/assert@1';
import { sliderToBlend } from '../../src/target.js';

Deno.test('sliderToBlend: 100% = photo only, 0% = vector only, 50% = mixed', () => {
  assertEquals(sliderToBlend(100), 1);
  assertEquals(sliderToBlend(0), 0);
  assertEquals(sliderToBlend(50), 0.5);
});

Deno.test('sliderToBlend clamps out-of-range input', () => {
  assertEquals(sliderToBlend(150), 1);
  assertEquals(sliderToBlend(-20), 0);
  assertEquals(sliderToBlend('75'), 0.75);
});
