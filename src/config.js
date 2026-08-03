// MapMax configuration — endpoints and app constants.

// OSM vector rendering (ground) — OpenFreeMap, no API key required.
export const OSM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Panoramax federated meta-catalog (STAC API + vector tiles).
export const PANORAMAX_API = 'https://api.panoramax.xyz/api';

// Initial view: central Paris, an area with dense Panoramax coverage.
export const START_VIEW = {
  center: [2.3504, 48.855],
  // z18.5: above the z17 picture-dot threshold (#56, #78) AND above the z18
  // building threshold (BUILDINGS_MIN_ZOOM, #82) so 360° dots and 3D buildings
  // both show on landing (landing must sit strictly above the building gate).
  zoom: 18.5,
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

// In street mode, only show/load Panoramax pictures within this radius (meters)
// around the current photosphere — keeps the scene light and POIs nearby (#27).
export const STREET_POI_RADIUS_M = 50;

// In street mode, only RENDER 3D buildings within this radius (meters) of the
// standpoint (#95). Far buildings are where the pitch-90 instability lives: a
// dense z14 tile's fill-extrusion bucket overflows MapLibre's 65535-vertex/
// segment limit (dropped), and the horizon-grazing frustum culls far tiles in
// and out — both show as buildings blinking. A radius clip keeps buckets small
// (no overflow) and depends only on POSITION, so looking around never re-clips.
// Default kept tight; live-tunable via ?buildingsRadius=<m> or the console setter.
export const STREET_BUILDINGS_RADIUS_M = 50;

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

// Polar.sh entitlements (#76). The sandbox host gates advanced access behind a
// license key, validated in the browser against Polar's PUBLIC customer-portal
// endpoint (no backend of ours, R3; organizationId is public and safe to ship).
// This is a soft, feature-demo gate on a static site — it showcases the
// purchase→unlock flow, it is not a cryptographic access boundary.
export const POLAR = {
  // The sandbox is now gated by HTTP Basic Auth at the Caddy edge (docker/Caddyfile),
  // not this in-app license overlay — simpler for a dev/PR sandbox. Flip to true to
  // bring back the Polar purchase→unlock showcase (#76).
  enabled: false,
  server: 'sandbox', // sandbox.polar.sh / sandbox-api.polar.sh
  apiBase: 'https://sandbox-api.polar.sh',
  organization: 'mapmax',
  organizationId: '654a60f6-322b-4fa7-970a-930be9fe6522',
  productName: 'MapMax Sandbox Access',
  // Checkout link (redirects to the hosted Polar checkout).
  checkoutUrl: 'https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_B1Xl8ZvjuLCrM0Uv0WdU4DLFxbISPrxLkwYtX4OrKZ5/redirect',
  // Host that requires a license (dev/e2e: add ?sandbox=1 to any host).
  gatedHost: 'sandbox.mapmax.confinia.io',
};
