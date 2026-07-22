// Pure arrow-selection logic (no browser APIs) — unit-tested with Deno.
//
// From the current picture and nearby candidates, choose which navigation
// arrows to draw on the street: nearest picture per direction sector, placed
// a few meters from the camera toward the target (SPECIFICATIONS.md §2.3).
import { angularDiff, bearingBetween, destinationPoint, distanceM } from './geo.js';

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

export function arrowsToGeoJSON(arrows) {
  return {
    type: 'FeatureCollection',
    features: arrows.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { targetId: a.targetId, bearing: a.bearing, sameSequence: a.sameSequence },
    })),
  };
}
