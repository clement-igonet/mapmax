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
