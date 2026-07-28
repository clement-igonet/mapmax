// Map-mode clutter cap (#41).
//
// In the tilted map, 3D building extrusions and Panoramax picture dots otherwise
// render all the way to the horizon — the whole city at once, cluttered and
// heavy. MapLibre v6 has no fog or `distance` expression to fade far content, so
// we bound it geometrically: cap the map pitch so the TOP of the viewport never
// looks at ground beyond `radiusM` from the centre. The far plane then stops
// well short of the horizon, and the tilt limit rises naturally as you zoom in
// (a smaller ground footprint per screen ⇒ more tilt fits inside the radius).
import { MAP_MAX_PITCH, MAP_MIN_PITCH_CAP, MAP_VISIBLE_RADIUS_M } from './config.js';

// Ground metres per screen pixel at the map centre (MapLibre 512-px tiles).
const METERS_PER_PIXEL_Z0 = 78271.517; // 40075016.686 m circumference / 512
export const metersPerPixel = (lat, zoom) =>
  (METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

// Ground distance (m) from the centre to where the top-of-viewport ray meets the
// ground, for a given pitch. MapLibre pitch is measured from straight-down; the
// camera sits `D` screen-px from the centre along the view axis (independent of
// pitch), so altitude = D·cos(pitch) and the top edge leaves at pitch + fov/2.
export function farRadiusM(pitchDeg, camToCenterPx, pixelsPerMeter, fovDeg) {
  const p = (pitchDeg * Math.PI) / 180;
  const half = (fovDeg * Math.PI) / 360;
  const topAngle = p + half;
  if (topAngle >= Math.PI / 2 - 1e-4) return Infinity; // top edge at/above horizon
  const altitudePx = camToCenterPx * Math.cos(p);
  const spanPx = altitudePx * (Math.tan(topAngle) - Math.tan(p));
  return spanPx / pixelsPerMeter;
}

// Largest pitch (deg) whose far radius is within `radiusM`, clamped to
// [minCap, hardMax]. Monotonic in pitch, so a binary search converges.
export function pitchForRadius(camToCenterPx, pixelsPerMeter, fovDeg, radiusM, hardMax = MAP_MAX_PITCH, minCap = MAP_MIN_PITCH_CAP) {
  if (!camToCenterPx || !pixelsPerMeter) return hardMax;
  const far = (deg) => farRadiusM(deg, camToCenterPx, pixelsPerMeter, fovDeg);
  if (far(hardMax) <= radiusM) return hardMax; // even full tilt fits
  let lo = 0;
  let hi = hardMax;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (far(mid) <= radiusM) lo = mid;
    else hi = mid;
  }
  return Math.max(minCap, lo);
}

// Wire the cap to the map. Recomputes on zoom/move and applies via setMaxPitch
// (which clamps the current pitch down when needed). Skips while in street mode,
// which owns its own pitch (the photosphere sits the camera near 90°).
export function setupClutterCap(map, isStreetMode, radiusM = MAP_VISIBLE_RADIUS_M) {
  const apply = () => {
    if (isStreetMode && isStreetMode()) return;
    const canvas = map.getCanvas();
    const heightPx = canvas.clientHeight || canvas.height;
    if (!heightPx) return; // not laid out yet
    // MapLibre's transform internals (cameraToCenterDistance / pixelsPerMeter)
    // aren't public in v6, so derive both from public API (validated against
    // unproject to ~1%): the camera sits 0.5/tan(fov/2)·height px from the centre,
    // and pixelsPerMeter is 1 / ground-metres-per-pixel at the centre.
    const fovDeg = typeof map.getVerticalFieldOfView === 'function' ? map.getVerticalFieldOfView() : 36.87;
    const camToCenterPx = (0.5 / Math.tan((fovDeg * Math.PI) / 360)) * heightPx;
    const pixelsPerMeter = 1 / metersPerPixel(map.getCenter().lat, map.getZoom());
    const cap = pitchForRadius(camToCenterPx, pixelsPerMeter, fovDeg, radiusM);
    // Only touch setMaxPitch on a real change — it fires move events itself.
    if (Math.abs(map.getMaxPitch() - cap) > 0.4) map.setMaxPitch(cap);
  };
  map.on('zoom', apply);
  map.on('move', apply);
  // The transform has no size until the map has loaded/laid out; (re)apply then.
  map.on('load', apply);
  map.on('resize', apply);
  apply();
  return apply;
}
