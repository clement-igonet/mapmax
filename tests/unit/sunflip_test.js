// Unit tests for the sun-compass orientation check (#66).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { solarPosition } from '../../src/suncalc.js';
import { decideFlip, sunUFromPixels } from '../../src/sunflip.js';

Deno.test('solarPosition: real capture (Paris, 2025-03-20 09:10 UTC) — the #66 case', () => {
  const { azimuth, elevation } = solarPosition('2025-03-20T09:10:31+00:00', 2.313577, 48.841299);
  assertAlmostEquals(azimuth, 130, 3); // verified independently (NOAA)
  assertAlmostEquals(elevation, 29, 3);
});

Deno.test('solarPosition: sanity — solar noon points south, night is below horizon', () => {
  // ~solar noon in Paris (UTC+0 ref: ~11:51 UTC around equinox)
  const noon = solarPosition('2025-03-20T11:51:00Z', 2.35, 48.85);
  assertAlmostEquals(noon.azimuth, 180, 6);
  assert(noon.elevation > 30);
  const night = solarPosition('2025-03-20T23:00:00Z', 2.35, 48.85);
  assert(night.elevation < 0, 'sun must be below the horizon at night');
});

Deno.test('decideFlip: the real backward-mount case flips, the aligned case does not', () => {
  // pic 0098117e: heading (view:azimuth) 208, solar az 130, sun seen at u≈0.75
  assertEquals(decideFlip(208, 130, 0.75), 180);
  // same sun, but a pano whose centre truly faces 208 would show it at u≈0.28
  assertEquals(decideFlip(208, 130, 0.28), 0);
  // compass-verified pic 2668bd15-style: heading 197, sun wherever it implies ~197 centre
  assertEquals(decideFlip(197, 130, 0.5 + ((130 - 197) / 360)), 0);
});

Deno.test('decideFlip: only gross (>90°) disagreement flips', () => {
  // implied centre 60° off → keep metadata (could be detection noise)
  assertEquals(decideFlip(0, 60, 0.5), 0);
  // implied centre 120° off → flip
  assertEquals(decideFlip(0, 120, 0.5), 180);
});

// Synthetic 64x32 equirect: blue sky above y=20, grey street below; optional
// bright blob at a column (in the sky), optional bright "façade" rectangle
// standing on the street (surrounded by grey, only its top touching sky).
function frame(w, h, opts = {}) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y < Math.floor(h * 0.62)) { d[i] = 90; d[i + 1] = 140; d[i + 2] = 210; } // sky
      else { d[i] = 120; d[i + 1] = 120; d[i + 2] = 118; } // street
      d[i + 3] = 255;
    }
  }
  if (opts.sunX != null) {
    for (let y = 4; y < 8; y++) {
      for (let dx = -1; dx <= 2; dx++) {
        const x = (opts.sunX + dx + w) % w;
        const i = (y * w + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 250;
      }
    }
  }
  if (opts.facadeX != null) {
    // Big bright wall from roofline down to the street, flanked by darker
    // building sides (real façades don't float in the sky): only its TOP edge
    // sees sky.
    for (let y = 6; y < h - 2; y++) {
      for (let x = opts.facadeX - 2; x < opts.facadeX + 14; x++) {
        const i = (y * w + x) * 4;
        const brightPart = x >= opts.facadeX && x < opts.facadeX + 12;
        d[i] = brightPart ? 250 : 150;
        d[i + 1] = brightPart ? 248 : 150;
        d[i + 2] = brightPart ? 244 : 148;
      }
    }
  }
  if (opts.overcast) {
    for (let y = 0; y < Math.floor(h * 0.62); y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        d[i] = 250; d[i + 1] = 250; d[i + 2] = 248;
      }
    }
  }
  return d;
}

const W = 64, H = 32;

Deno.test('sunUFromPixels: finds a sky-surrounded sun blob at the right u', () => {
  const u = sunUFromPixels(frame(W, H, { sunX: 48 }), W, H);
  assertAlmostEquals(u, 48.5 / W, 0.05);
});

Deno.test('sunUFromPixels: a bright façade does not fool it — sun still wins (#66)', () => {
  // façade has ~3× the bright pixels of the sun but its ring is street/façade
  const u = sunUFromPixels(frame(W, H, { sunX: 48, facadeX: 8 }), W, H);
  assertAlmostEquals(u, 48.5 / W, 0.05);
});

Deno.test('sunUFromPixels: façade alone (no visible sun) → null, not a false positive', () => {
  assertEquals(sunUFromPixels(frame(W, H, { facadeX: 8 }), W, H), null);
});

Deno.test('sunUFromPixels: handles a sun straddling the seam (x wrap)', () => {
  const u = sunUFromPixels(frame(W, H, { sunX: 0 }), W, H);
  assert(u < 0.06 || u > 0.94, `expected u near the seam, got ${u}`);
});

Deno.test('sunUFromPixels: rejects overcast (whole sky bright, ring is ground) and clear sky', () => {
  assertEquals(sunUFromPixels(frame(W, H, { overcast: true }), W, H), null);
  assertEquals(sunUFromPixels(frame(W, H, {}), W, H), null);
});
