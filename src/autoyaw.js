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
