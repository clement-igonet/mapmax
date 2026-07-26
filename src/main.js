// MapMax entry point — MapLibre map with OSM ground rendering and 3D buildings.
import { OSM_STYLE_URL, START_VIEW, MAX_PITCH } from './config.js';
import { addPanoramaxLayers, onPictureClick, getPicture } from './panoramax.js';
import { enterStreetView, exitStreetView, isStreetMode } from './streetview.js';
import { setupNavigation } from './navigation.js';
import { hardenStyle, transparentPixel } from './stylefix.js';

const status = (msg) => {
  document.getElementById('hud-status').textContent = msg;
};

// The style is hardened BEFORE map creation so not a single frame renders
// raw null-able expressions (#14 — verified by the containerized Chromium e2e).
async function loadHardenedStyle() {
  try {
    const style = await (await fetch(OSM_STYLE_URL)).json();
    return hardenStyle(style);
  } catch (err) {
    console.warn('style hardening failed, using raw style', err);
    return OSM_STYLE_URL;
  }
}

export const map = new maplibregl.Map({
  container: 'map',
  style: await loadHardenedStyle(),
  ...START_VIEW,
  maxPitch: MAX_PITCH,
  hash: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
setupNavigation(map);

map.on('style.load', () => {
  ensureBuildings3D();
  addPanoramaxLayers(map);
  status('Zoom in and click a Panoramax picture dot.');
});

// Sprite icons referenced by the style but absent from its sprite sheet
// would log a warning per POI type; register a transparent placeholder.
map.on('styleimagemissing', (e) => {
  if (!map.hasImage(e.id)) map.addImage(e.id, transparentPixel());
});

onPictureClick(map, async (id) => {
  status('Loading picture metadata…');
  const watchdog = setInterval(
    () => status('Still loading — street-level images can be large…'),
    8000
  );
  try {
    const pic = await getPicture(id);
    status('Loading image…');
    await enterStreetView(map, pic);
    document.getElementById('exit-street').hidden = false;
    status(`${pic.type} by ${pic.producer || 'unknown'} — drag to look, scroll to zoom, Esc to exit.`);
  } catch (err) {
    console.error(err);
    status(`Failed to load picture: ${err.message || 'image could not be loaded'}`);
  } finally {
    clearInterval(watchdog);
  }
});

const exitBtn = document.getElementById('exit-street');
const leaveStreetUI = () => {
  exitBtn.hidden = true;
  status('Zoom in and click a Panoramax picture dot.');
};
exitBtn.addEventListener('click', () => {
  if (isStreetMode()) exitStreetView(map);
  leaveStreetUI();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !isStreetMode()) leaveStreetUI();
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
