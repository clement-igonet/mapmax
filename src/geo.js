// Pure geometry/math helpers — no browser APIs, unit-tested with Deno.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

const EARTH_CIRCUMFERENCE_M = 40075016.686;

// Zoom level whose MapLibre camera altitude equals `eyeM` meters, given the
// viewport height (CSS px), vertical fov, latitude and pitch. Derivation:
// cameraToCenterDistance(px) = (h/2)/tan(fov/2); altitude = distance * cos(pitch);
// meters/px at zoom z = cos(lat) * C / (512 * 2^z).
export function zoomForEyeHeight(viewportHeightPx, fovDeg, lat, pitchDeg, eyeM) {
  const distPx = viewportHeightPx / 2 / Math.tan(deg2rad(fovDeg) / 2);
  const groundMeters =
    distPx * Math.cos(deg2rad(pitchDeg)) * Math.cos(deg2rad(lat)) * EARTH_CIRCUMFERENCE_M;
  return Math.log2(groundMeters / (512 * eyeM));
}

// three.js sphere yaw so that the equirectangular image center faces compass
// `heading` (world axes: north = -Z, east = +X, up = +Y; sphere x-flipped).
export function sphereYawForHeading(headingDeg, yawOffsetRad = 0) {
  return -deg2rad(headingDeg) - Math.PI / 2 + yawOffsetRad;
}

// three.js camera Euler angles (order YXZ) for a MapLibre bearing/pitch.
export function cameraAnglesFor(bearingDeg, pitchDeg) {
  return {
    yaw: -deg2rad(bearingDeg),
    pitch: deg2rad(pitchDeg - 90),
  };
}

// Initial compass bearing from (lon1,lat1) to (lon2,lat2), degrees [0,360).
export function bearingBetween(lon1, lat1, lon2, lat2) {
  const φ1 = deg2rad(lat1);
  const φ2 = deg2rad(lat2);
  const Δλ = deg2rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (rad2deg(Math.atan2(y, x)) + 360) % 360;
}

// Haversine distance in meters.
export function distanceM(lon1, lat1, lon2, lat2) {
  const R = 6371008.8;
  const φ1 = deg2rad(lat1);
  const φ2 = deg2rad(lat2);
  const Δφ = deg2rad(lat2 - lat1);
  const Δλ = deg2rad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Point at `distM` meters from (lon,lat) toward compass `bearingDeg`.
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const δ = distM / 6371008.8;
  const θ = deg2rad(bearingDeg);
  const φ1 = deg2rad(lat);
  const λ1 = deg2rad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [rad2deg(λ2), rad2deg(φ2)];
}

// Smallest signed angular difference a-b in degrees, in (-180, 180].
export function angularDiff(aDeg, bDeg) {
  let d = (aDeg - bDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
