// Style hardening helpers (pure, unit-tested) — fixes for issue #14.

// OSM buildings frequently miss height tags; reading them raw yields
// "Expected value to be of type number, but found null". Coalesce to defaults.
export const buildingHeightExpr = (fallbackM = 6) => [
  'coalesce',
  ['get', 'render_height'],
  fallbackM,
];

export const buildingBaseExpr = () => ['coalesce', ['get', 'render_min_height'], 0];

// 1×1 transparent placeholder for sprite icons missing from the style's
// sprite sheet (silences "Image … could not be loaded" warnings).
export const transparentPixel = () => ({
  width: 1,
  height: 1,
  data: new Uint8Array(4),
});
