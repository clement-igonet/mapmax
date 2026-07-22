// MapMax entry point — MapLibre map with OSM ground rendering and 3D buildings.
import { OSM_STYLE_URL, START_VIEW, MAX_PITCH } from './config.js';

const status = (msg) => {
  document.getElementById('hud-status').textContent = msg;
};

export const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE_URL,
  ...START_VIEW,
  maxPitch: MAX_PITCH,
  hash: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

map.on('style.load', () => {
  ensureBuildings3D();
  status('Map ready — OSM ground + 3D buildings.');
});

map.on('error', (e) => {
  console.error('Map error', e.error);
});

// The Liberty style ships a `building-3d` fill-extrusion layer; if the style
// ever changes, add our own extrusion from the OSM `building` source layer.
function ensureBuildings3D() {
  const style = map.getStyle();
  if (style.layers.some((l) => l.type === 'fill-extrusion')) return;

  const buildingLayer = style.layers.find((l) => l['source-layer'] === 'building');
  if (!buildingLayer) {
    console.warn('No building source-layer found in style; skipping 3D buildings.');
    return;
  }
  map.addLayer({
    id: 'mapmax-buildings-3d',
    type: 'fill-extrusion',
    source: buildingLayer.source,
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-extrusion-color': 'hsl(35,8%,85%)',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.8,
    },
  });
}
