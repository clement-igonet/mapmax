// Near-only 3D buildings for street mode (#60).
//
// The tiled `building-3d` extrusions render to the horizon, and far buildings
// never line up with the photo (they'd need per-pixel depth). MapLibre v6 has no
// per-feature distance expression, so while inside a photosphere we HIDE the
// tiled extrusions and instead render a small GeoJSON "bubble" of only the
// buildings within BUILDINGS_RADIUS_M of the viewer — the ones that actually
// match the photo. On the map we leave the normal tiled buildings alone.
//
// The geometry core (nearestVertexDistanceM / buildingsWithinRadius) is pure and
// unit-tested; setupNearBuildings wires it to the map.
import { BUILDINGS_RADIUS_M } from './config.js';
import { distanceM } from './geo.js';

export const NEAR_BUILDINGS_SRC = 'mapmax-buildings-near';
export const NEAR_BUILDINGS_LAYER = 'mapmax-buildings-near';
const EMPTY = { type: 'FeatureCollection', features: [] };

// Smallest distance (m) from (lng,lat) to any vertex of a GeoJSON geometry.
export function nearestVertexDistanceM(geometry, lng, lat) {
  let min = Infinity;
  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      const d = distanceM(lng, lat, coords[0], coords[1]);
      if (d < min) min = d;
    } else {
      for (const c of coords) scan(c);
    }
  };
  if (geometry && geometry.coordinates) scan(geometry.coordinates);
  return min;
}

// From raw building features (e.g. map.querySourceFeatures output), keep those
// within `radius` of (lng,lat), de-duplicated, as a small extrusion collection.
export function buildingsWithinRadius(features, lng, lat, radius = BUILDINGS_RADIUS_M) {
  const out = [];
  const seen = new Set();
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const p = f.properties || {};
    const key = f.id != null ? `id:${f.id}` : `g:${JSON.stringify(f.geometry.coordinates?.[0]?.[0])}`;
    if (seen.has(key)) continue;
    if (nearestVertexDistanceM(f.geometry, lng, lat) > radius) continue;
    seen.add(key);
    out.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        render_height: p.render_height ?? p.height ?? 6,
        render_min_height: p.render_min_height ?? p.min_height ?? 0,
      },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

const BUILDING_PAINT = {
  'fill-extrusion-color': 'hsl(35,8%,85%)',
  'fill-extrusion-height': ['get', 'render_height'],
  'fill-extrusion-base': ['get', 'render_min_height'],
  'fill-extrusion-opacity': 0.85,
};

// Wire the near-building bubble to the map. `isStreetMode()` gates it (bubble
// only inside a photosphere; the map keeps its normal tiled buildings). Returns
// an `update()` you can call after blend changes (which re-reveal tiled layers).
export function setupNearBuildings(map, isStreetMode, refPoint, options = {}) {
  const radius = options.radius ?? BUILDINGS_RADIUS_M;

  const tiledExtrusions = () =>
    map.getStyle().layers.filter((l) => l.type === 'fill-extrusion' && l.id !== NEAR_BUILDINGS_LAYER);

  if (!map.getSource(NEAR_BUILDINGS_SRC)) {
    map.addSource(NEAR_BUILDINGS_SRC, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: NEAR_BUILDINGS_LAYER, type: 'fill-extrusion', source: NEAR_BUILDINGS_SRC, paint: BUILDING_PAINT });
  }

  const update = () => {
    const bubble = map.getLayer(NEAR_BUILDINGS_LAYER);
    if (!isStreetMode || !isStreetMode()) {
      // Map mode: bubble off, restore the normal tiled extrusions (#41 caps the
      // map). Restoring here is what un-hides them again on exit from a sphere.
      if (bubble) map.setLayoutProperty(NEAR_BUILDINGS_LAYER, 'visibility', 'none');
      map.getSource(NEAR_BUILDINGS_SRC)?.setData(EMPTY);
      for (const l of tiledExtrusions()) map.setLayoutProperty(l.id, 'visibility', 'visible');
      return;
    }
    // Street mode: hide the far tiled skyline, show the near bubble.
    const tiled = tiledExtrusions();
    for (const l of tiled) map.setLayoutProperty(l.id, 'visibility', 'none');
    if (bubble) map.setLayoutProperty(NEAR_BUILDINGS_LAYER, 'visibility', 'visible');
    const src = tiled[0]?.source;
    const srcLayer = tiled[0]?.['source-layer'] || 'building';
    const ref = refPoint();
    if (!src || !ref) return;
    let feats = [];
    try { feats = map.querySourceFeatures(src, { sourceLayer: srcLayer }); } catch { feats = []; }
    map.getSource(NEAR_BUILDINGS_SRC).setData(buildingsWithinRadius(feats, ref[0], ref[1], radius));
  };

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 200); };
  map.on('move', schedule);
  map.on('sourcedata', schedule);
  update();
  return update;
}
