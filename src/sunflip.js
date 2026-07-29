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

// The yaw offset (0 or 180) to add to the metadata heading. impliedCentre is
// where the image centre REALLY points, given the sun at `sunU` and the solar
// azimuth; if that contradicts the metadata heading by more than 90°, the pano
// is mounted backward.
export function decideFlip(headingDeg, solarAzimuthDeg, sunU) {
  const impliedCentre = solarAzimuthDeg - (sunU - 0.5) * 360;
  const delta = ((impliedCentre - headingDeg + 540) % 360) - 180;
  return Math.abs(delta) > 90 ? 180 : 0;
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

// Full check for a normalized picture: 0 (trust metadata) or 180 (flipped).
// Runs even when EXIF GPSImgDirection exists — some cameras (GoPro Max) fill it
// from the GPS track, not a magnetometer, so it proves nothing about the image
// centre; the >90° gate keeps genuinely-correct panos untouched. Needs the sun
// ≥5° up; inconclusive → 0.
export async function sunYawOffset(pic) {
  if (!pic) return 0;
  try {
    const { azimuth, elevation } = solarPosition(pic.datetime, pic.lon, pic.lat);
    if (elevation < 5) return 0;
    const expectedV = (90 - elevation) / 180; // equirect v of the sun (0 = zenith)
    const u = await detectSunU(pic.assets?.sd || pic.assets?.thumb, expectedV);
    if (u == null) return 0;
    return decideFlip(pic.heading || 0, azimuth, u);
  } catch {
    return 0;
  }
}
