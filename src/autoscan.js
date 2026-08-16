// Orientation auto-fix capture (#142) — the browser half of the comparison:
// build two horizon strips indexed by the SAME assumed world azimuth, so the
// yaw error is a pure horizontal shift (the maths lives in autoyaw.js).
//
//   world strip — the vector scene (buildings, streets) seen from the
//     picture's stand-point: spin the street-mode camera through 360° at the
//     horizon and stitch the centre slice of each frame. Reading the map
//     canvas needs `preserveDrawingBuffer` on the Map (see main.js).
//   photo strip — the panorama IS an equirect: resample its horizon band
//     directly, mapping each azimuth bin through the pose's panoYaw. No
//     spinning, no resampling error beyond one column lookup.
//
// Only the horizon band is compared: it carries the façade/skyline structure
// both renderings share, and it is where a yaw error shows up as displacement.
import { edgeProfile, skylineProfile } from './autoyaw.js';

export const SCAN_BINS = 180; // 2° per bin — 1° adds time, not accuracy
const BAND_DEG = 24; // vertical band around the horizon, in degrees
const STRIP_H = 48; // pixels per strip (enough for a skyline, cheap to scan)

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function scratch(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Spin the camera and stitch the vector world into an azimuth-indexed strip.
 * Restores the camera, field of view and blend it found, whatever happens.
 * @returns {Promise<ImageData>} width = bins, height = STRIP_H
 */
export async function scanWorldStrip(map, ps, { bins = SCAN_BINS, setBlend, blendAfter = 0.5, onProgress } = {}) {
  const canvas = map.getCanvas();
  const out = scratch(bins, STRIP_H);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const savedYaw = ps.yaw;
  const savedPitch = ps.pitch;
  try {
    setBlend(0); // vector only — the photosphere layer (and its nav dots) go fully transparent
    ps.look(0, -savedPitch); // level with the horizon: the band we compare
    const fovY = ps._options.fov;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    // Screen geometry of one bin at the centre of the view (small-angle: the
    // slice is 2° wide, where the tangent distortion is under a thousandth).
    const tanY = Math.tan((fovY * Math.PI) / 360);
    const pxPerDegX = canvas.width / ((2 * Math.atan(tanY * aspect) * 180) / Math.PI);
    const pxPerDegY = canvas.height / fovY;
    const sliceW = Math.max(1, Math.round((360 / bins) * pxPerDegX));
    const bandH = Math.max(2, Math.round(BAND_DEG * pxPerDegY));
    const sx = Math.round(canvas.width / 2 - sliceW / 2);
    const sy = Math.round(canvas.height / 2 - bandH / 2);
    for (let j = 0; j < bins; j++) {
      ps.look(((((j * 360) / bins - ps.yaw) % 360) + 540) % 360 - 180, 0);
      await frame();
      await frame(); // one to schedule the repaint, one to let it land
      ctx.drawImage(canvas, sx, sy, sliceW, bandH, j, 0, 1, STRIP_H);
      if (onProgress && j % 10 === 0) onProgress(j / bins);
    }
    return ctx.getImageData(0, 0, bins, STRIP_H);
  } finally {
    ps.look(((((savedYaw - ps.yaw) % 360) + 540) % 360) - 180, savedPitch - ps.pitch);
    setBlend(blendAfter); // back to the mix the user was looking at
  }
}

/**
 * Resample the panorama's horizon band into the same azimuth bins.
 * `panoYaw` is the world azimuth the image centre currently claims to face,
 * so bin j (azimuth j·360/bins) reads column u = 0.5 + (azimuth − panoYaw)/360
 * — the shader's own mapping. Pitch/roll are ignored: they shift the band
 * vertically by a couple of degrees, which the column features tolerate.
 */
export async function photoStrip(imageUrl, panoYaw, { bins = SCAN_BINS } = {}) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('panorama image could not be read for the scan'));
    im.src = imageUrl;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const out = scratch(bins, STRIP_H);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const y0 = Math.round((h * (0.5 - BAND_DEG / 360)));
  const bandH = Math.max(2, Math.round((h * BAND_DEG) / 180));
  const colW = Math.max(1, Math.round(w / bins));
  for (let j = 0; j < bins; j++) {
    const azimuth = (j * 360) / bins;
    const u = ((0.5 + (azimuth - panoYaw) / 360) % 1 + 1) % 1;
    ctx.drawImage(img, Math.round(u * w) % w, y0, colW, bandH, j, 0, 1, STRIP_H);
  }
  return ctx.getImageData(0, 0, bins, STRIP_H);
}

// Both features of a strip, ready for proposeYawDelta().
export const stripProfiles = (strip) => ({ skyline: skylineProfile(strip), edge: edgeProfile(strip) });

// A strip rolled horizontally by `deg` — how the panorama would sit after
// applying a correction, without touching the picture (#142 live preview).
export function rollStrip(strip, deg, bins = strip.width) {
  const shift = ((Math.round((deg / 360) * bins) % bins) + bins) % bins;
  const out = new ImageData(strip.width, strip.height);
  for (let y = 0; y < strip.height; y++) {
    for (let x = 0; x < strip.width; x++) {
      const src = ((x + shift) % strip.width + y * strip.width) * 4;
      const dst = (x + y * strip.width) * 4;
      out.data[dst] = strip.data[src];
      out.data[dst + 1] = strip.data[src + 1];
      out.data[dst + 2] = strip.data[src + 2];
      out.data[dst + 3] = strip.data[src + 3];
    }
  }
  return out;
}
