// #122: below COVERAGE_MIN_ZOOM no imagery-source coverage renders, so no
// coverage tiles are requested at world/country zooms. Sanity-bound the gate:
// city scale or tighter (a low value reintroduces the freeze), and always
// looser than the picture-dot gate (#56, z17) so lines appear before dots.
import { assert } from 'jsr:@std/assert@1';
import { COVERAGE_MIN_ZOOM } from '../../src/config.js';

Deno.test('coverage gate: city-scale, below the dot gate (#122)', () => {
  assert(COVERAGE_MIN_ZOOM >= 9, `gate too loose (${COVERAGE_MIN_ZOOM}) — low zooms would fetch worldwide coverage`);
  assert(COVERAGE_MIN_ZOOM <= 14, `gate too tight (${COVERAGE_MIN_ZOOM}) — coverage would appear only at street zoom`);
  assert(COVERAGE_MIN_ZOOM < 17, 'sequence lines must appear before the z17 picture dots');
});
