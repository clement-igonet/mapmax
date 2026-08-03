// Pure helper for the street-mode 3D-building radius clip (#95). No browser APIs.

// A MapLibre filter that keeps only features within `radiusM` metres of
// [lng, lat], preserving the layer's own `orig` filter (ANDed under `all`).
//
// Uses the `distance` expression, NOT `within`: building polygons are clipped to
// tile boundaries, so `within` treats them as not fully contained and drops
// everything. Keying the clip on the standpoint (position) means looking around
// never re-clips — the building set is stable under in-place rotation (#87) — and
// dropping the far buildings keeps fill-extrusion buckets small, under MapLibre's
// 65535-vertex/segment limit (the overflow that made far buildings blink).
export function buildingRadiusFilter(orig, lng, lat, radiusM) {
  const near = ['<=', ['distance', { type: 'Point', coordinates: [lng, lat] }], radiusM];
  return orig ? ['all', orig, near] : near;
}

// The clip runs on the `staging` and `sandbox` environments (not prod yet, #95),
// or on any host with ?sandbox=1 (dev/e2e). Env is deployment-baked (env.js),
// so this is deployment-driven, not URL-driven.
export function buildingsClipEnabled(env, search) {
  if (/[?&]sandbox=1(&|$)/.test(search || '')) return true;
  return env === 'staging' || env === 'sandbox';
}

// Live tuning: a ?buildingsRadius=<metres> override in the URL query. Returns
// `fallback` when absent or malformed; 0 is honoured (disables the clip).
export function parseRadiusOverride(search, fallback) {
  const m = /[?&]buildingsRadius=(\d+(?:\.\d+)?)/.exec(search || '');
  if (!m) return fallback;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : fallback;
}
