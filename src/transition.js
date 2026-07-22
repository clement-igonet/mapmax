// Pure transition planning (no browser APIs) — unit-tested with Deno.
//
// A move between two close pictures is played as continuous movement
// (SPECIFICATIONS.md §2.4): the current sphere is dollied backward along the
// travel direction (camera walks forward) and cross-faded into the target
// sphere, which settles from a slight zoom. Duration scales with distance.
import { bearingBetween, clamp, distanceM } from './geo.js';

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function transitionPlan(from, to) {
  const dist = distanceM(from.lon, from.lat, to.lon, to.lat);
  return {
    dist,
    bearing: bearingBetween(from.lon, from.lat, to.lon, to.lat),
    duration: clamp(300 + dist * 35, 400, 1200),
    dolly: 0.35, // fraction of the sphere radius the old sphere travels
    zoomFrom: 1.18, // target sphere settles from this scale to 1
    fadeStart: 0.35, // old sphere starts fading at this progress
  };
}

// Opacities at eased progress `e` — old fades out late, target fades in early,
// so there is never a gap (no white flash, no hard cut).
export function crossfadeAt(e, plan) {
  return {
    oldOpacity: 1 - Math.max(0, (e - plan.fadeStart) / (1 - plan.fadeStart)),
    newOpacity: Math.min(1, e / (1 - plan.fadeStart)),
    newScale: plan.zoomFrom - (plan.zoomFrom - 1) * e,
  };
}
