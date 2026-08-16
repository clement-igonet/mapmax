// Orientation auto-fix maths (#142) — pure, unit-tested offline (no DOM, no
// WebGL): given two horizon strips indexed by ASSUMED world azimuth — one
// rendered from the vector world (MapLibre camera), one resampled from the
// panorama — find the rotation that aligns them.
//
// Both strips share the same azimuth binning by construction, so a yaw error
// is exactly a horizontal shift: reduce each strip to a 1D per-column feature
// and take the circular cross-correlation peak. Two features are computed
// because neither works everywhere:
//   - skyline (where sky meets buildings): the strongest shared signal, but
//     absent under trees, at night, or in open sky;
//   - vertical-edge energy (façade corners, windows, poles): always defined,
//     noisier.
// The better-scoring one wins, and the score is reported so a weak match is
// surfaced instead of silently rotating the picture.

const luma = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

/**
 * Per-column vertical-edge energy of a strip (ImageData-shaped input).
 * @returns {Float32Array} one finite value per column
 */
export function edgeProfile({ data, width, height }) {
  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let e = 0;
    for (let y = 1; y < height; y++) {
      e += Math.abs(luma(data, (y * width + x) * 4) - luma(data, ((y - 1) * width + x) * 4));
    }
    out[x] = e;
  }
  return out;
}

/**
 * Per-column skyline: the first row (from the top, as a 0..1 fraction of the
 * strip height) where luminance drops `drop` below the column's top pixel —
 * i.e. where the sky ends. NaN when no such transition exists (no sky in that
 * column); the correlation ignores those columns.
 */
export function skylineProfile({ data, width, height }, { maxRowFrac = 0.8, drop = 0.18 } = {}) {
  const out = new Float32Array(width).fill(NaN);
  const maxRow = Math.max(2, Math.floor(height * maxRowFrac));
  for (let x = 0; x < width; x++) {
    const top = luma(data, x * 4);
    for (let y = 1; y < maxRow; y++) {
      if (top - luma(data, (y * width + x) * 4) > drop) {
        out[x] = y / height;
        break;
      }
    }
  }
  return out;
}

// Pearson correlation of a[i] vs b[(i+shift) % n] over the pairs where both
// are finite (NaN = "no signal in this column"). Returns NaN when too few
// pairs survive to mean anything.
function correlationAt(a, b, shift, minPairs) {
  const n = a.length;
  let count = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[(i + shift) % n];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    count++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (count < minPairs) return NaN;
  const cov = sab / count - (sa / count) * (sb / count);
  const va = saa / count - (sa / count) ** 2;
  const vb = sbb / count - (sb / count) ** 2;
  const denom = Math.sqrt(va * vb);
  return denom > 1e-12 ? cov / denom : NaN;
}

/**
 * Circular cross-correlation peak: the shift (in columns) that best aligns
 * `a` onto `b`, i.e. maximizing corr(a[i], b[(i + shift) % n]).
 *
 * `margin` is the peak minus the best competing peak at least 10° away — a
 * high score with a low margin means a repetitive scene (a colonnade, a row
 * of identical windows) where several rotations fit equally well.
 */
export function bestCircularShift(a, b) {
  const n = a.length;
  if (!n || b.length !== n) throw new Error('bestCircularShift: profiles must share a length');
  const minPairs = Math.max(8, Math.round(n * 0.15));
  const scores = new Float64Array(n).fill(-2);
  let shift = 0, score = -2;
  for (let s = 0; s < n; s++) {
    const r = correlationAt(a, b, s, minPairs);
    scores[s] = Number.isFinite(r) ? r : -2;
    if (scores[s] > score) { score = scores[s]; shift = s; }
  }
  const away = Math.max(2, Math.round(n / 36)); // 10° guard around the peak
  let rival = -2;
  for (let s = 0; s < n; s++) {
    const d = Math.min((s - shift + n) % n, (shift - s + n) % n);
    if (d > away && scores[s] > rival) rival = scores[s];
  }
  return { shift, score: score > -2 ? score : NaN, margin: score > -2 && rival > -2 ? score - rival : NaN };
}

// Columns → signed degrees in (−180, 180].
export const shiftToDeg = (shift, n) => {
  const d = ((shift / n) * 360) % 360;
  return d > 180 ? d - 360 : d;
};

/**
 * The yaw correction to ADD to the picture's current yaw offset.
 *
 * `photo[i]` is what the panorama CLAIMS sits at azimuth bin i; if it really
 * matches the vector world at bin i+shift, the picture's azimuths are short by
 * that much, so the offset grows by the same amount.
 *
 * @param {{skyline: Float32Array, edge: Float32Array}} photo
 * @param {{skyline: Float32Array, edge: Float32Array}} world
 * @returns {{deltaDeg: number, score: number, margin: number, method: string, shift: number}}
 */
export function proposeYawDelta(photo, world) {
  const candidates = [
    { method: 'skyline', ...bestCircularShift(photo.skyline, world.skyline) },
    { method: 'edges', ...bestCircularShift(photo.edge, world.edge) },
  ].filter((c) => Number.isFinite(c.score));
  if (!candidates.length) return { deltaDeg: 0, score: NaN, margin: NaN, method: 'none', shift: 0 };
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return { ...best, deltaDeg: shiftToDeg(best.shift, photo.edge.length) };
}

// Is a proposal trustworthy enough to offer? Correlating a photo against a
// synthetic 3D render never reaches 0.9 — 0.35 with a clear margin is a solid
// match in practice, and everything below is reported as uncertain.
export const isConfident = ({ score, margin }) => score >= 0.35 && margin >= 0.1;

// --- Pitch and roll from the same two bands (#142) ---------------------------
// Once the yaw is aligned, whatever VERTICAL offset remains between the photo
// skyline and the world skyline is a tilt. For small angles the horizon of a
// camera tilted by (pitch about its right axis, roll about its forward axis)
// is displaced by
//     Δelev(a) = pitch·cos(a) + roll·sin(a) + C
// where `a` is the azimuth relative to the image centre: straight ahead only
// pitch moves it, 90° to the side only roll does. C absorbs a systematic bias
// (eye height, "skyline" meaning roof edge in one rendering and gutter in the
// other) so it cannot masquerade as tilt.
//
// The result is ABSOLUTE (the photo band is sampled from the raw image, not
// from the posed render), so it is a pitch/roll to SET, not to add.

// Least squares over the basis [1, cos a, sin a] via the 3×3 normal equations.
function solve3(m, v) {
  const a = [[...m[0], v[0]], [...m[1], v[1]], [...m[2], v[2]]];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-9) return null; // singular: not enough spread
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * @param {Float32Array|number[]} diffDeg  photo − world skyline, in degrees, per bin (NaN = no signal)
 * @param {Float32Array|number[]} relAzDeg azimuth of each bin relative to the image centre
 * @returns {{pitchDeg: number, rollDeg: number, offsetDeg: number, rms: number, samples: number}}
 *          pitch/roll are NaN when too few bins carry a skyline to fit.
 */
export function fitTilt(diffDeg, relAzDeg) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  let samples = 0;
  const rows = [];
  for (let i = 0; i < diffDeg.length; i++) {
    const d = diffDeg[i];
    if (!Number.isFinite(d)) continue;
    const a = (relAzDeg[i] * Math.PI) / 180;
    const basis = [1, Math.cos(a), Math.sin(a)];
    rows.push({ basis, d });
    for (let r = 0; r < 3; r++) {
      v[r] += basis[r] * d;
      for (let c = 0; c < 3; c++) M[r][c] += basis[r] * basis[c];
    }
    samples++;
  }
  const none = { pitchDeg: NaN, rollDeg: NaN, offsetDeg: NaN, rms: NaN, samples };
  if (samples < 12) return none;
  const sol = solve3(M, v);
  if (!sol) return none;
  const [offsetDeg, pitchDeg, rollDeg] = sol;
  let sq = 0;
  for (const { basis, d } of rows) {
    const fit = basis[0] * offsetDeg + basis[1] * pitchDeg + basis[2] * rollDeg;
    sq += (d - fit) ** 2;
  }
  // Standard error of each coefficient: s²·diag((XᵀX)⁻¹). This is what lets
  // pitch and roll be judged SEPARATELY — a scene can pin one and not the
  // other (a long straight street constrains roll far better than pitch).
  const s2 = sq / Math.max(1, samples - 3);
  const inv = invDiag3(M);
  const se = inv ? inv.map((d) => Math.sqrt(Math.max(0, s2 * d))) : [NaN, NaN, NaN];
  return {
    pitchDeg, rollDeg, offsetDeg,
    rms: Math.sqrt(sq / samples),
    sePitch: se[1], seRoll: se[2],
    samples,
  };
}

// Diagonal of the inverse of a symmetric 3×3 (cofactors / determinant).
function invDiag3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [(e * i - f * h) / det, (a * i - c * g) / det, (a * e - b * d) / det];
}

/**
 * Is a single fitted axis worth offering? It must be big enough to matter AND
 * stand clear of its own uncertainty — a 2σ signal. Reported per axis, so a
 * confident roll is never withheld because the pitch was unmeasurable.
 */
export const axisSignificant = (coefDeg, seDeg, minDeg = 0.5) =>
  Number.isFinite(coefDeg) && Math.abs(coefDeg) >= minDeg
  && Number.isFinite(seDeg) && Math.abs(coefDeg) >= 2 * seDeg;

// Enough skyline columns to fit at all, and at least one axis that clears its
// own noise. (Per-axis decisions use axisSignificant directly.)
export const tiltIsUsable = (t) =>
  t.samples >= 24
  && (axisSignificant(t.pitchDeg, t.sePitch) || axisSignificant(t.rollDeg, t.seRoll));

// Vertical displacement (in strip rows) that a tilt produces at azimuth `a` —
// the inverse of fitTilt's model. Re-rendering the photo band through this is
// what lets the comparison CONTINUE on the remaining axes after one has been
// corrected: the band shown is the band as it now is, not as it was captured.
export function tiltRowShift(relAzDeg, pitchDeg, rollDeg, bandDeg, stripH) {
  const a = (relAzDeg * Math.PI) / 180;
  return (((pitchDeg || 0) * Math.cos(a) + (rollDeg || 0) * Math.sin(a)) / bandDeg) * stripH;
}
