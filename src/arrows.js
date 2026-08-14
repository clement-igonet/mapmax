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
  // Where the arrow lies on the ground, from the camera. Kept in a safe band so
  // the arrow (and its polygon, ~2 m long) never gets close enough to cross the
  // camera near plane and be clipped — even for a very close neighbour (#26).
  minArrowDist: 6,
  arrowDist: 9,
  // #55: the forward/back walk arrows are snapped to the capture/travel axis
  // (the picture's `heading` = view:azimuth), which is far steadier than noisy
  // point-to-point GPS bearings (Panoramax positions are often only ~4 m
  // accurate — in a narrow street that throws the arrow right off the path).
  axisCone: 55, // a neighbour within this of the axis can anchor an axis arrow
  axisDistWeight: 4, // metres→degrees weight when choosing the axis target
};

function makeArrow(current, s, drawBearing, o) {
  // At least minArrowDist (never near the camera), at most arrowDist, and not
  // overshooting a far neighbour beyond arrowDist.
  const placeDist = Math.min(o.arrowDist, Math.max(o.minArrowDist, s.dist));
  const [lon, lat] = destinationPoint(current.lon, current.lat, drawBearing, placeDist);
  return {
    targetId: s.pic.id,
    bearing: drawBearing,
    dist: s.dist,
    lon,
    lat,
    sameSequence: s.pic.sequenceId === current.sequenceId,
  };
}

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
  const used = new Set();
  const heading = typeof current.heading === 'number' ? current.heading : null;

  // #55: primary forward/back arrows along the travel axis, drawn AT the heading
  // (not the neighbour's jittered GPS bearing) so they point straight down the
  // street. The target is the best neighbour near that axis (aligned, then near).
  if (heading != null) {
    for (const axis of [heading, (heading + 180) % 360]) {
      let best = null;
      let bestCost = Infinity;
      for (const s of scored) {
        if (used.has(s.pic.id)) continue;
        const off = Math.abs(angularDiff(s.bearing, axis));
        if (off > o.axisCone) continue;
        const cost = off + s.dist * o.axisDistWeight;
        if (cost < bestCost) { bestCost = cost; best = s; }
      }
      if (best) {
        used.add(best.pic.id);
        chosen.push(makeArrow(current, best, axis, o));
      }
    }
  }

  // Remaining neighbours → side arrows at their true bearing (turns/crossings),
  // one per direction sector, not clashing with an axis arrow already placed.
  for (const s of scored) {
    if (chosen.length >= o.limit) break;
    if (used.has(s.pic.id)) continue;
    if (chosen.some((c) => Math.abs(angularDiff(c.bearing, s.bearing)) < o.sector)) continue;
    used.add(s.pic.id);
    chosen.push(makeArrow(current, s, s.bearing, o));
  }
  return chosen;
}

// The arrow whose direction best matches `headingDeg` (the way the user is
// looking), within `maxDiff` degrees — used to "advance" with the keyboard or
// double-click (SPECIFICATIONS.md §2.5). Returns null when nothing lies ahead.
// Fair per-source dot selection (#112): `items` sorted nearest-first, each
// carrying a `source`. A dense source (Panoramax in a French city centre)
// would otherwise claim every one of the `cap` slots and the other sources'
// dots would never appear. Reserve the nearest `perSource` of EACH source,
// fill the rest by pure distance, return nearest-first.
export function fairMixBySource(items, cap, perSource = 3) {
  const chosen = new Map(); // id -> item (insertion keeps stable identity)
  for (const src of new Set(items.map((p) => p.source))) {
    let n = 0;
    for (const p of items) {
      if (p.source !== src || n >= perSource) continue;
      chosen.set(p.id, p);
      n++;
    }
  }
  for (const p of items) {
    if (chosen.size >= cap) break;
    chosen.set(p.id, p);
  }
  return [...chosen.values()].sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0)).slice(0, cap);
}

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
