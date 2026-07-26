// MapMax configuration — endpoints and app constants.

// OSM vector rendering (ground) — OpenFreeMap, no API key required.
export const OSM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Panoramax federated meta-catalog (STAC API + vector tiles).
export const PANORAMAX_API = 'https://api.panoramax.xyz/api';

// Initial view: central Paris, an area with dense Panoramax coverage.
export const START_VIEW = {
  center: [2.3504, 48.855],
  zoom: 16.5,
  pitch: 55,
  bearing: 0,
};

// Base map pitch limit (map mode). Street mode raises it so the photosphere
// plugin can sit the camera at pitch ~90 (human sight) — see streetview.js.
export const MAP_MAX_PITCH = 85;
export const STREET_MAX_PITCH = 179;

// Photosphere plugin defaults (SPECIFICATIONS.md §2.2, §2.5).
export const PHOTOSPHERE = {
  eyeHeight: 1.6,
  radius: 6,
  fov: 75,
  durationMs: 1200,
  dragSensitivity: 0.15,
  minPitch: -85,
  maxPitch: 85,
};
