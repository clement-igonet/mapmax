// Unit tests for the 50/50 default photo↔vector blend (#101).
import { assertEquals } from 'jsr:@std/assert@1';
import { STREET_DEFAULT_BLEND } from '../../src/config.js';
import { sliderToBlend } from '../../src/target.js';

Deno.test('street mode defaults to a 50/50 photo↔vector mix (#101)', () => {
  assertEquals(STREET_DEFAULT_BLEND, 0.5);
});

Deno.test('the blend slider markup matches the default (#101)', () => {
  // index.html is static; its initial value must agree with the constant so the
  // UI never shows a different mix than the one rendered on entry.
  const html = Deno.readTextFileSync(new URL('../../index.html', import.meta.url));
  const m = html.match(/id="blend"[^>]*value="(\d+)"/s);
  assertEquals(Number(m?.[1]), STREET_DEFAULT_BLEND * 100);
});

Deno.test('slider default round-trips through sliderToBlend (#101)', () => {
  assertEquals(sliderToBlend(STREET_DEFAULT_BLEND * 100), STREET_DEFAULT_BLEND);
});
