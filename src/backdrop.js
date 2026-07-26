// Street-mode backdrop (#37).
//
// The very-low street camera leaves parts of the frustum uncovered by vector
// data, so the style's near-white background (#f8f4f0) shows as a raw "empty
// white area" whenever the photosphere is transparent (vector-only blend), and
// ground arrows draped on the plane get cut at that edge. In photo mode the
// sphere hides all this; here we recolor the background to a neutral ground
// tone so the vector view reads as continuous ground rather than raw white.
// Fully reversible on exit.

export const STREET_GROUND_COLOR = '#d7d9dc'; // neutral pavement grey

let savedBg = null;
let applied = false;

export function applyStreetBackdrop(map) {
  if (applied) return;
  applied = true;
  try {
    savedBg = map.getPaintProperty('background', 'background-color') ?? null;
    map.setPaintProperty('background', 'background-color', STREET_GROUND_COLOR);
  } catch { /* style without a background layer */ }
}

export function removeStreetBackdrop(map) {
  if (!applied) return;
  applied = false;
  try {
    if (savedBg != null) map.setPaintProperty('background', 'background-color', savedBg);
  } catch { /* ignore */ }
  savedBg = null;
}

export const _backdropApplied = () => applied;
