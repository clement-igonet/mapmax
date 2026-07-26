// Tile-loading budget for street mode (#11).
//
// At pitch ~90 (the photosphere camera) MapLibre requests tiles all the way to
// the horizon — effectively unbounded loading of the OSM ground/buildings AND
// the Panoramax POI tiles. But while inside the photosphere the sphere covers
// the whole viewport, so those tiled layers are invisible anyway. We suspend
// every tile-backed layer while inside (which stops MapLibre from fetching its
// tiles) and restore them on exit. GeoJSON/custom layers (nav arrows, the
// photosphere itself) are untouched — they carry no tile cost.

const TILED_SOURCE_TYPES = new Set(['vector', 'raster', 'raster-dem']);

// Pure: ids of the layers whose source is a tiled source (so hiding them stops
// tile requests). Layers with no source (background, custom) are excluded.
export function tiledLayerIds(style) {
  const sources = style.sources || {};
  return (style.layers || [])
    .filter((l) => l.source && TILED_SOURCE_TYPES.has(sources[l.source]?.type))
    .map((l) => l.id);
}

let suspended = null; // Map<layerId, priorVisibility>

export function suspendTileLayers(map) {
  if (suspended) return;
  suspended = new Map();
  for (const id of tiledLayerIds(map.getStyle())) {
    if (!map.getLayer(id)) continue;
    suspended.set(id, map.getLayoutProperty(id, 'visibility') ?? 'visible');
    map.setLayoutProperty(id, 'visibility', 'none');
  }
}

export function resumeTileLayers(map) {
  if (!suspended) return;
  for (const [id, vis] of suspended) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  suspended = null;
}

export const _isSuspended = () => !!suspended;
