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

// Native sky (MapLibre 6): a blue sky fading through a pale horizon into the
// ground tone, so the above-horizon area is a real sky (not raw canvas) and the
// horizon haze visually connects to the ground — the environment always fills
// the viewport at any pitch (#43).
const STREET_SKY = {
  'sky-color': '#a6c8f0',
  'horizon-color': '#e6eef7',
  'fog-color': STREET_GROUND_COLOR,
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.6,
};

let savedBg = null;
let applied = false;

export function applyStreetBackdrop(map) {
  if (applied) return;
  applied = true;
  try {
    savedBg = map.getPaintProperty('background', 'background-color') ?? null;
    map.setPaintProperty('background', 'background-color', STREET_GROUND_COLOR);
  } catch { /* style without a background layer */ }
  try {
    map.setSky(STREET_SKY);
  } catch { /* sky unsupported */ }
}

export function removeStreetBackdrop(map) {
  if (!applied) return;
  applied = false;
  try {
    if (savedBg != null) map.setPaintProperty('background', 'background-color', savedBg);
  } catch { /* ignore */ }
  try {
    map.setSky(null);
  } catch { /* ignore */ }
  savedBg = null;
}

export const _backdropApplied = () => applied;
