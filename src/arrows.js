// Pure arrow-selection logic (no browser APIs) — unit-tested with Deno.
//
// From the current picture and nearby candidates, choose which navigation
// arrows to draw on the street: nearest picture per direction sector, placed
// a few meters from the camera toward the target (SPECIFICATIONS.md §2.3).
import { angularDiff, bearingBetween, destinationPoint, distanceM, rad2deg } from './geo.js';

export const ARROW_DEFAULTS = {
  maxDist: 30, // ignore pictures farther than this (meters)
  minDist: 1.5, // ignore near-duplicates at the same spot
  sector: 35, // one arrow per direction sector (degrees)
  limit: 6,
  arrowDist: 5.5, // where the arrow lies on the ground, from the camera
};

export function pickArrows(current, candidates, options = {}) {
  const o = { ...ARROW_DEFAULTS, ...options };
  const scored = candidates
    .filter((c) => c.id !== current.id)
    .map((c) => ({
      pic: c,
      dist: distanceM(current.lon, current.lat, c.lon, c.lat),
      bearing: bearingBetween(current.lon, current.lat, c.lon, c.lat),
    }))
    .filter((s) => s.dist >= o.minDist && s.dist <= o.maxDist)
    .sort((a, b) => a.dist - b.dist);

  const chosen = [];
  for (const s of scored) {
    if (chosen.length >= o.limit) break;
    if (chosen.some((c) => Math.abs(angularDiff(c.bearing, s.bearing)) < o.sector)) continue;
    const [lon, lat] = destinationPoint(
      current.lon, current.lat, s.bearing,
      Math.min(o.arrowDist, s.dist * 0.6)
    );
    chosen.push({
      targetId: s.pic.id,
      bearing: s.bearing,
      dist: s.dist,
      lon,
      lat,
      sameSequence: s.pic.sequenceId === current.sequenceId,
    });
  }
  return chosen;
}

// The arrow whose direction best matches `headingDeg` (the way the user is
// looking), within `maxDiff` degrees — used to "advance" with the keyboard or
// double-click (SPECIFICATIONS.md §2.5). Returns null when nothing lies ahead.
export function chooseByHeading(arrows, headingDeg, maxDiff = 55) {
  let best = null;
  let bestDiff = Infinity;
  for (const a of arrows) {
    const d = Math.abs(angularDiff(a.bearing, headingDeg));
    if (d < bestDiff) {
      bestDiff = d;
      best = a;
    }
  }
  return best && bestDiff <= maxDiff ? best : null;
}

// A ground arrow drawn as REAL geographic geometry (not a billboard icon): an
// arrowhead chevron in local meters, oriented toward `bearingDeg` and converted
// to lng/lat. Rendered by a fill layer it lies flat on the street and is never
// clipped like a foreshortened icon quad at grazing pitch (#26).
// Local shape: +y = forward (bearing), +x = right; units ≈ meters × `scale`.
const ARROW_SHAPE = [
  [0, 2.2],   // tip
  [1.4, 0.4], // right wing
  [0.5, 0.4], // right inner
  [0.5, -1.0],// right tail
  [-0.5, -1.0],// left tail
  [-0.5, 0.4],// left inner
  [-1.4, 0.4],// left wing
];

export function groundArrowPolygon(lon, lat, bearingDeg, scale = 1) {
  const ring = ARROW_SHAPE.map(([x, y]) => {
    const dist = Math.hypot(x, y) * scale;
    const brng = bearingDeg + rad2deg(Math.atan2(x, y));
    return destinationPoint(lon, lat, brng, dist);
  });
  ring.push(ring[0]); // close the ring
  return [ring];
}

export function arrowsToGeoJSON(arrows, scale = 1) {
  return {
    type: 'FeatureCollection',
    features: arrows.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: groundArrowPolygon(a.lon, a.lat, a.bearing, scale) },
      properties: { targetId: a.targetId, bearing: a.bearing, sameSequence: a.sameSequence },
    })),
  };
}
