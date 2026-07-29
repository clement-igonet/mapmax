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

// Map-mode clutter cap (#41): in the tilted map, don't render 3D buildings and
// Panoramax dots out to the horizon. MapLibre v6 has no fog / distance
// expression, so we cap the tilt so the top of the viewport never sees ground
// beyond this radius from the centre — tilt unlocks as you zoom in. Never cap
// below MAP_MIN_PITCH_CAP (keep a little 3D even when zoomed out).
export const MAP_VISIBLE_RADIUS_M = 160;
export const MAP_MIN_PITCH_CAP = 20;

// Street mode (#60): only render 3D building extrusions within this radius of the
// viewer. MapLibre has no per-feature distance expression, so the far tiled
// skyline is replaced by a GeoJSON "bubble" of just the nearby buildings — the
// only ones that line up with the photo anyway. Customizable.
// 150 m: covers the visible street canyon (a Haussmann block face runs 60–150 m)
// while still excluding the horizon skyline — at 50 m only one or two buildings
// qualified and every neighbour looked like it had "disappeared" at blend.
export const BUILDINGS_RADIUS_M = 150;

// In street mode, only show/load Panoramax pictures within this radius (meters)
// around the current photosphere — keeps the scene light and POIs nearby (#27).
export const STREET_POI_RADIUS_M = 50;

// Photosphere plugin defaults (SPECIFICATIONS.md §2.2, §2.5).
// fov 80: at eye height the 75° view left the near foreground unrendered by
// MapLibre (an empty band, #43); 80° tilts the bottom edge down enough for the
// ground to render to the screen edge, with no perceptible widening.
export const PHOTOSPHERE = {
  eyeHeight: 1.6,
  radius: 6,
  fov: 80,
  durationMs: 1200,
  dragSensitivity: 0.15,
  minPitch: -85,
  maxPitch: 85,
};
