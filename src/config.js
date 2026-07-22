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

export const MAX_PITCH = 85;
