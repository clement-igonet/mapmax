// Unit tests for the orientation auto-fix maths (#142): column features,
// circular correlation, and the sign of the proposed yaw delta.
import { assert, assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  bestCircularShift,
  edgeProfile,
  isConfident,
  proposeYawDelta,
  shiftToDeg,
  skylineProfile,
} from '../../src/autoyaw.js';

const N = 180; // 2° azimuth bins

// A deterministic "cityscape": a few harmonics + a couple of sharp landmarks,
// so the correlation peak is unambiguous like a real skyline.
function cityscape(n = N) {
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = Math.sin((2 * Math.PI * i) / n) + 0.6 * Math.sin((6 * Math.PI * i) / n + 1.1);
  }
  p[10] += 3; p[11] += 2.5; p[95] += 2; // landmarks
  return p;
}

const rotate = (p, k) => {
  const n = p.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = p[(i + k + n * 2) % n];
  return out;
};

// A strip of ImageData shape: sky on top down to `skyRows[x]`, dark below.
function strip(width, height, skyRows) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const v = y < skyRows[x] ? 230 : 40;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

Deno.test('skylineProfile: finds the sky→building transition per column, NaN without sky', () => {
  const rows = [2, 5, 7, 0]; // last column: building from the very top → no sky
  const s = skylineProfile(strip(4, 12, rows));
  assertAlmostEquals(s[0], 2 / 12, 1e-6);
  assertAlmostEquals(s[1], 5 / 12, 1e-6);
  assertAlmostEquals(s[2], 7 / 12, 1e-6);
  assert(Number.isNaN(s[3]), 'a column without sky must be NaN, not 0');
  // The search stops at maxRowFrac: a "sky" filling most of the strip is not a
  // skyline (open sky, overexposure) and must read as no-signal, not as a
  // spurious horizon near the bottom.
  assert(Number.isNaN(skylineProfile(strip(1, 12, [11]))[0]), 'transition below the guard must stay NaN');
});

Deno.test('edgeProfile: energy tracks the number of transitions, always finite', () => {
  const e = edgeProfile(strip(3, 10, [3, 3, 0]));
  assert(e.every(Number.isFinite));
  assert(e[0] > 0.5 && e[1] > 0.5, 'a sky/building edge must register');
  assertAlmostEquals(e[2], 0, 1e-6); // uniform column: no vertical edge
});

Deno.test('bestCircularShift: recovers a known rotation, including wrap-around', () => {
  const world = cityscape();
  for (const k of [0, 7, 90, N - 3]) {
    // photo[i] = world[(i + k) % N] → the correlation must report shift = k
    const photo = rotate(world, k);
    const { shift, score } = bestCircularShift(photo, world);
    assertEquals(shift, k % N, `shift for k=${k}`);
    assert(score > 0.99, `a pure rotation must correlate near 1 (got ${score})`);
  }
  assertThrows(() => bestCircularShift(new Float32Array(4), new Float32Array(5)), Error, 'share a length');
});

Deno.test('bestCircularShift: tolerates NaN gaps and noise', () => {
  const world = cityscape();
  const photo = rotate(world, 25);
  for (let i = 0; i < N; i += 3) photo[i] = NaN; // a third of the columns blind
  for (let i = 0; i < N; i++) if (Number.isFinite(photo[i])) photo[i] += 0.15 * Math.sin(i * 12.9898);
  const { shift, score, margin } = bestCircularShift(photo, world);
  assertEquals(shift, 25);
  assert(score > 0.8 && margin > 0.1, `expected a clear peak, got score=${score} margin=${margin}`);
});

Deno.test('bestCircularShift: featureless input yields no usable peak', () => {
  const flat = new Float32Array(N); // constant → zero variance
  const { score, margin } = bestCircularShift(flat, cityscape());
  assert(!Number.isFinite(score) || !isConfident({ score, margin }), 'must not claim confidence on a blank strip');
  const blind = new Float32Array(N).fill(NaN);
  assert(!Number.isFinite(bestCircularShift(blind, cityscape()).score), 'all-NaN must not produce a score');
});

Deno.test('shiftToDeg: signed degrees, shortest way round', () => {
  assertAlmostEquals(shiftToDeg(0, 180), 0, 1e-9);
  assertAlmostEquals(shiftToDeg(45, 180), 90, 1e-9);
  assertAlmostEquals(shiftToDeg(90, 180), 180, 1e-9);
  assertAlmostEquals(shiftToDeg(135, 180), -90, 1e-9); // 270° → −90°
  assertAlmostEquals(shiftToDeg(179, 180), -2, 1e-9);
});

Deno.test('proposeYawDelta: sign is the correction to ADD to the yaw offset (#142)', () => {
  const world = { skyline: cityscape(), edge: cityscape() };
  // The picture is mounted 30° short: what it labels azimuth i really sits at
  // i + 15 bins (15 × 2° = 30°). The fix must be +30°.
  const photo = { skyline: rotate(world.skyline, 15), edge: rotate(world.edge, 15) };
  const p = proposeYawDelta(photo, world);
  assertAlmostEquals(p.deltaDeg, 30, 1e-6);
  assert(isConfident(p), `a clean match must be confident (score=${p.score}, margin=${p.margin})`);
  // And a picture already correct proposes no change.
  assertAlmostEquals(proposeYawDelta(world, world).deltaDeg, 0, 1e-9);
});

Deno.test('proposeYawDelta: picks the better-scoring feature, degrades gracefully', () => {
  const world = { skyline: cityscape(), edge: cityscape() };
  // Skyline blinded (night / trees): the edge channel must carry the fix.
  const photo = { skyline: new Float32Array(N).fill(NaN), edge: rotate(world.edge, 20) };
  const p = proposeYawDelta(photo, world);
  assertEquals(p.method, 'edges');
  assertAlmostEquals(p.deltaDeg, 40, 1e-6);
  // Nothing usable at all → an explicit no-proposal, never a silent 0-confidence rotation.
  const dead = { skyline: new Float32Array(N).fill(NaN), edge: new Float32Array(N) };
  const none = proposeYawDelta(dead, world);
  assertEquals(none.deltaDeg, 0);
  assert(!isConfident(none));
});

Deno.test('fitTilt: recovers pitch and roll from the vertical offset (#142)', async () => {
  const { fitTilt, tiltIsUsable } = await import('../../src/autoyaw.js');
  const rel = new Float32Array(N);
  for (let i = 0; i < N; i++) rel[i] = (i * 360) / N - 180; // −180…180 around the centre
  const make = (pitch, roll, offset = 0) => {
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (rel[i] * Math.PI) / 180;
      d[i] = offset + pitch * Math.cos(a) + roll * Math.sin(a);
    }
    return d;
  };
  const clean = fitTilt(make(-3.2, 1.7, 0.4), rel);
  assertAlmostEquals(clean.pitchDeg, -3.2, 1e-4);
  assertAlmostEquals(clean.rollDeg, 1.7, 1e-4);
  assertAlmostEquals(clean.offsetDeg, 0.4, 1e-4); // bias absorbed, not read as tilt
  assert(clean.rms < 1e-4 && tiltIsUsable(clean));

  // Gaps and noise: still close, and still usable.
  const noisy = make(2.5, -1.0);
  for (let i = 0; i < N; i += 4) noisy[i] = NaN;
  for (let i = 0; i < N; i++) if (Number.isFinite(noisy[i])) noisy[i] += 0.3 * Math.sin(i * 7.3);
  const nf = fitTilt(noisy, rel);
  assertAlmostEquals(nf.pitchDeg, 2.5, 0.3);
  assertAlmostEquals(nf.rollDeg, -1.0, 0.3);

  // Too few skyline columns → no proposal at all.
  const sparse = new Float32Array(N).fill(NaN);
  for (let i = 0; i < 8; i++) sparse[i] = 1;
  assert(Number.isNaN(fitTilt(sparse, rel).pitchDeg));
  assert(!tiltIsUsable(fitTilt(sparse, rel)));
  // Pure noise: the residual dwarfs the fitted tilt → not offered.
  const junk = new Float32Array(N);
  for (let i = 0; i < N; i++) junk[i] = 6 * Math.sin(i * 3.7) * Math.cos(i * 1.9);
  assert(!tiltIsUsable(fitTilt(junk, rel)));
});

Deno.test('tiltRowShift: inverts the fit model, so a corrected band can be re-rendered (#142)', async () => {
  const { fitTilt, tiltRowShift } = await import('../../src/autoyaw.js');
  const band = 24, H = 48, pitch = -3, roll = 2;
  // The shift applied per column must reproduce exactly the displacement the
  // fit measured — otherwise the regenerated band would drift from the maths.
  const rel = new Float32Array(N);
  const diff = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rel[i] = (i * 360) / N - 180;
    diff[i] = tiltRowShift(rel[i], pitch, roll, band, H) * (band / H); // rows → degrees
  }
  const f = fitTilt(diff, rel);
  assertAlmostEquals(f.pitchDeg, pitch, 1e-4);
  assertAlmostEquals(f.rollDeg, roll, 1e-4);
  // Straight ahead only pitch moves the band; 90° to the side, only roll.
  assertAlmostEquals(tiltRowShift(0, pitch, roll, band, H), (pitch / band) * H, 1e-9);
  assertAlmostEquals(tiltRowShift(90, pitch, roll, band, H), (roll / band) * H, 1e-9);
  assertAlmostEquals(tiltRowShift(0, 0, 0, band, H), 0, 1e-9);
});

Deno.test('axisSignificant: each axis is judged against its own uncertainty (#142)', async () => {
  const { axisSignificant, fitTilt, tiltIsUsable } = await import('../../src/autoyaw.js');
  // Big and precise → offered. Big but uncertain → withheld. Precise but tiny → withheld.
  assert(axisSignificant(-3.2, 0.4));
  assert(!axisSignificant(-3.2, 2.0), 'a coefficient inside 2σ of its own error is noise');
  assert(!axisSignificant(0.2, 0.01), 'below the practical floor, however precise');
  assert(!axisSignificant(NaN, 0.1) && !axisSignificant(1, NaN));

  // A scene that pins ROLL but not pitch must still offer the roll.
  const rel = new Float32Array(N);
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rel[i] = (i * 360) / N - 180;
    const a = (rel[i] * Math.PI) / 180;
    d[i] = 4 * Math.sin(a); // pure roll, no pitch component
  }
  const f = fitTilt(d, rel);
  assertAlmostEquals(f.rollDeg, 4, 1e-4);
  assert(axisSignificant(f.rollDeg, f.seRoll), 'a clean roll must be offered');
  assert(!axisSignificant(f.pitchDeg, f.sePitch), 'an absent pitch must not be invented');
  assert(tiltIsUsable(f), 'one significant axis makes the fit usable');
});
