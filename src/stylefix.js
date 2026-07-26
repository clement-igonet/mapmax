// Style hardening helpers (pure, unit-tested) — fixes for issue #14.

// 1×1 transparent placeholder for sprite icons missing from the style's
// sprite sheet (silences "Image … could not be loaded" warnings).
export const transparentPixel = () => ({
  width: 1,
  height: 1,
  data: new Uint8Array(4),
});

// OSM-derived numeric attributes that are frequently absent; reading them raw
// with ["get", …] as a NUMBER VALUE (not a comparison) throws "Expected value
// to be of type number, but found null" — e.g. fill-extrusion height/base.
// Map each to a safe default (#14).
export const NULLABLE_NUMERIC_DEFAULTS = {
  render_height: 6,
  render_min_height: 0,
};

// Ordering comparisons require both operands to be numbers and throw on null.
// Any ["get", P] used as their operand (rank, admin_level, ref_length, …) must
// be guarded. A missing value is treated as "least important / most detailed":
// 0 keeps `<=` filters permissive and `>=` filters exclusive, which is the
// conservative choice for the crowd-sourced fields that are often absent.
const ORDERING_OPS = new Set(['<', '<=', '>', '>=']);
const COMPARISON_DEFAULT = 0;

const isBareGet = (n) =>
  Array.isArray(n) && n.length === 2 && n[0] === 'get' && typeof n[1] === 'string';
const isGuarded = (n) => Array.isArray(n) && n[0] === 'coalesce' && isBareGet(n[1]);
const guard = (getNode, dflt) => ['coalesce', getNode, dflt];

// Deep-clones a MapLibre style, wrapping every ["get", P] that would be read as
// a number in ["coalesce", ["get", P], default] — as a standalone nullable
// numeric value, or as an operand of an ordering comparison — anywhere it
// appears (paint, layout, filter). Idempotent: gets already inside a coalesce
// are left as-is.
export function hardenStyle(style) {
  const harden = (node) => {
    // Standalone nullable numeric value (e.g. fill-extrusion-height).
    if (isBareGet(node) && node[1] in NULLABLE_NUMERIC_DEFAULTS) {
      return guard(['get', node[1]], NULLABLE_NUMERIC_DEFAULTS[node[1]]);
    }
    if (Array.isArray(node)) {
      // Ordering comparison: guard any bare get operand against null.
      if (ORDERING_OPS.has(node[0]) && node.length >= 3) {
        return node.map((child) =>
          isBareGet(child) ? guard(child, COMPARISON_DEFAULT) : harden(child)
        );
      }
      // Preserve an already-guarded coalesce wrapper (idempotent).
      if (isGuarded(node)) return [node[0], node[1], ...node.slice(2).map(harden)];
      return node.map(harden);
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) out[k] = harden(node[k]);
      return out;
    }
    return node;
  };
  return harden(style);
}
