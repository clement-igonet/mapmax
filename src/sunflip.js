// Sun-compass orientation check (#66).
//
// Some cameras write no compass heading (Exif GPSImgDirection absent), so
// Panoramax derives view:azimuth from the GPS track = TRAVEL direction. If the
// camera was mounted backward, the equirectangular's centre faces travel+180 and
// the whole photosphere renders 180° flipped ("I walk forward, the scene
// recedes"). Metadata cannot reveal the mount — but the SUN can: its azimuth at
// capture is computable from datetime+GPS, so finding it in the image gives the
// image's true centre azimuth. We only correct the gross case (>90° disagreement
// → +180°), never fine-tune, so a slightly-off detection can't hurt.
//
// sunUFromPixels/decideFlip are pure (unit-tested); detectSunU needs a canvas.
import { solarPosition } from './suncalc.js';

// Horizontal position u ∈ [0,1) of the sun in a downsampled equirectangular
// (RGBA `data`, width w, height h), or null when no confident sun is found.
//
// Brightness alone is not enough on a street: a sunlit white façade can carry
// far more near-white pixels than the sun's flare. The discriminator is
// context — the sun is a bright blob SURROUNDED BY SKY. We flood-fill bright
// connected components (wrapping across the equirect seam), then score each by
// the fraction of blue-sky pixels in its surrounding ring; a façade's ring is
// mostly building/street. `expectedV` (from the known solar elevation) adds a
// row-position bonus. Overcast skies form one huge blob whose ring is ground →
// rejected naturally.
export function sunUFromPixels(data, w, h, opts = {}) {
  const o = { minY: 0.04, maxY: 0.48, bright: 235, minArea: 8, minSkyFrac: 0.35, expectedV: null, ...opts };
  const y0 = Math.floor(h * o.minY);
  const y1 = Math.floor(h * o.maxY);
  const idx = (x, y) => (y * w + ((x + w) % w)) * 4;
  const isBright = (x, y) => {
    const i = idx(x, y);
    return data[i] >= o.bright && data[i + 1] >= o.bright && data[i + 2] >= o.bright - 15;
  };
  const isSky = (x, y) => {
    // Blue-leaning and bright. Deliberately loose: near the sun's flare the sky
    // is washed out (blue barely above red) — measured on real panos, this still
    // separates sun (ring ~0.6 sky) from a white façade (ring ~0.0).
    const i = idx(x, y);
    return data[i + 2] >= 140 && data[i + 2] - data[i] >= 8;
  };

  const seen = new Uint8Array(w * h);
  let best = null;
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (seen[sy * w + sx] || !isBright(sx, sy)) continue;
      // BFS one component (x wraps across the seam).
      const stack = [[sx, sy]];
      seen[sy * w + sx] = 1;
      const comp = [];
      while (stack.length) {
        const [x, y] = stack.pop();
        comp.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = (x + dx + w) % w;
          const ny = y + dy;
          if (ny < y0 || ny >= y1 || seen[ny * w + nx]) continue;
          if (isBright(nx, ny)) {
            seen[ny * w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      if (comp.length < o.minArea) continue;
      // Ring: neighbours just outside the component.
      let ring = 0;
      let ringSky = 0;
      const inComp = new Set(comp.map(([x, y]) => y * w + x));
      for (const [x, y] of comp) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = (x + dx + w) % w;
          const ny = y + dy;
          if (ny < 0 || ny >= h || inComp.has(ny * w + nx)) continue;
          ring++;
          if (isSky(nx, ny)) ringSky++;
        }
      }
      const skyFrac = ring ? ringSky / ring : 0;
      if (skyFrac < o.minSkyFrac) continue;
      // Circular centroid of the component.
      let ss = 0;
      let sc = 0;
      let vSum = 0;
      for (const [x, y] of comp) {
        const ang = (2 * Math.PI * x) / w;
        ss += Math.sin(ang);
        sc += Math.cos(ang);
        vSum += y;
      }
      const u = ((Math.atan2(ss, sc) / (2 * Math.PI)) + 1) % 1;
      const v = vSum / comp.length / h;
      let score = skyFrac;
      if (o.expectedV != null) score += 0.4 * Math.exp(-(((v - o.expectedV) / 0.1) ** 2));
      if (!best || score > best.score) best = { u, score };
    }
  }
  return best ? best.u : null;
}

// One picture's VOTE: 180 (backward mount), 0 (orientation confirmed), or null
// (abstain). impliedCentre is where the image centre really points, given the
// sun at `sunU` and the solar azimuth. Hysteresis (#71): a genuine backward
// mount disagrees by ≈180°, a genuine forward mount by ≈0° — anything in the
// middle band is more likely a misdetected cloud than a signal, so abstain.
export function decideFlip(headingDeg, solarAzimuthDeg, sunU) {
  const impliedCentre = solarAzimuthDeg - (sunU - 0.5) * 360;
  const delta = Math.abs(((impliedCentre - headingDeg + 540) % 360) - 180);
  if (delta > 135) return 180;
  if (delta < 45) return 0;
  return null;
}

// Consensus across per-picture votes (#71): the sun is fixed in the world while
// clouds are random per picture, so a real mount direction produces consistent
// votes. Conclusive only when ≥2 votes agree and at most one dissents.
export function consensusVerdict(votes) {
  const v = votes.filter((x) => x === 0 || x === 180);
  const flips = v.filter((x) => x === 180).length;
  const keeps = v.length - flips;
  if (flips >= 2 && keeps <= 1) return 180;
  if (keeps >= 2 && flips <= 1) return 0;
  return null;
}

// Browser: load `url` into a small canvas and locate the sun. `expectedV` is
// the sun's expected vertical position (from its known elevation), used to
// disambiguate candidates. Resolves null on any failure (cross-origin, decode,
// no confident sun).
export function detectSunU(url, expectedV = null) {
  return new Promise((resolve) => {
    if (!url || typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 256;
        const h = 128;
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        resolve(sunUFromPixels(cx.getImageData(0, 0, w, h).data, w, h, { expectedV }));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Verdict for one picture: 180 (flipped), 0 (sun found, orientation confirmed),
// or null (inconclusive — sun below 5°, not visible, or load failure).
// Runs even when EXIF GPSImgDirection exists — some cameras (GoPro Max) fill it
// from the GPS track, not a magnetometer, so it proves nothing about the image
// centre; the >90° gate keeps genuinely-correct panos untouched.
// Below this solar elevation the sun is a diffuse glow — scattered by haze,
// reflected by glass façades — and every "detection" is junk (#71: an evening
// ride at ≤8° produced repeated false flip votes). Abstain entirely.
export const SUN_MIN_ELEVATION_DEG = 12;

export async function sunYawVerdict(pic) {
  if (!pic) return null;
  try {
    const { azimuth, elevation } = solarPosition(pic.datetime, pic.lon, pic.lat);
    if (elevation < SUN_MIN_ELEVATION_DEG) return null;
    const expectedV = (90 - elevation) / 180; // equirect v of the sun (0 = zenith)
    const u = await detectSunU(pic.assets?.sd || pic.assets?.thumb, expectedV);
    if (u == null) return null;
    return decideFlip(pic.heading || 0, azimuth, u);
  } catch {
    return null;
  }
}

// Back-compat wrapper: inconclusive → 0.
export async function sunYawOffset(pic) {
  return (await sunYawVerdict(pic)) ?? 0;
}
