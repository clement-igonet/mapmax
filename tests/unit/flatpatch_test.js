// Unit tests for the flat-picture patch placement (#46) — pure maths only:
// the destination rectangle of a flat photo on the equirect canvas.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { patchRect } from '../../src/flatpatch.js';

const W = 4096;
const H = 2048;
const close = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

Deno.test('patchRect: square image at hfov 90° spans a 90°×90° window, centred', () => {
  const r = patchRect(90, 1000, 1000, W, H);
  assert(close(r.w, (W * 90) / 360)); // 1024
  assert(close(r.h, (H * 90) / 180)); // square image: vfov = hfov = 90°
  assert(close(r.x + r.w / 2, W / 2)); // horizontally centred (heading = panoYaw)
  assert(close(r.y + r.h / 2, H / 2)); // vertically centred on the horizon
});

Deno.test('patchRect: vertical FOV follows the pinhole model, not the aspect ratio', () => {
  // 2:1 landscape at hfov 70 → vfov = 2·atan(tan(35°)·0.5) ≈ 38.6°, NOT 35°.
  const r = patchRect(70, 2000, 1000, W, H);
  const vfov = (r.h / H) * 180;
  assert(close(vfov, 38.6, 0.2));
  // Portrait 3:4 at the same hfov is taller than wide.
  const p = patchRect(70, 1500, 2000, W, H);
  assert(p.h / H > (p.w / W) * (2048 / 4096) && p.h > r.h);
});

Deno.test('patchRect: clamps degenerate FOVs and defaults a missing one to 70°', () => {
  assertEquals(patchRect(undefined, 1000, 1000, W, H).w, (W * 70) / 360);
  assertEquals(patchRect(0, 1000, 1000, W, H).w, (W * 70) / 360); // falsy → default
  assertEquals(patchRect(359, 1000, 1000, W, H).w, (W * 160) / 360); // capped: a "flat" claim of ~360 is bogus
  assertEquals(patchRect(2, 1000, 1000, W, H).w, (W * 10) / 360); // floor
});
