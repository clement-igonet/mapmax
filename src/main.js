// MapMax entry point — MapLibre map with OSM ground rendering and 3D buildings.
import { OSM_STYLE_URL, START_VIEW, MAX_PITCH } from './config.js';
import { addPanoramaxLayers, onPictureClick, getPicture } from './panoramax.js';

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
  addPanoramaxLayers(map);
  status('Zoom in and click a Panoramax picture dot.');
});

onPictureClick(map, async (id) => {
  status('Loading picture metadata…');
  try {
    const pic = await getPicture(id);
    showPicturePopup(pic);
    status('Picture loaded.');
  } catch (err) {
    console.error(err);
    status(`Failed to load picture: ${err.message}`);
  }
});

function showPicturePopup(pic) {
  const date = pic.datetime ? new Date(pic.datetime).toLocaleDateString() : '?';
  new maplibregl.Popup({ maxWidth: '340px' })
    .setLngLat([pic.lon, pic.lat])
    .setHTML(
      `<div class="pic-popup">
        <img src="${pic.assets.thumb || pic.assets.sd || ''}" alt="Panoramax picture" />
        <div class="pic-meta">
          <b>${pic.type}</b> · heading ${Math.round(pic.heading)}° · ${date}<br>
          by ${pic.producer || 'unknown'} · ${pic.license || ''}<br>
          sequence ${pic.sequenceId ? pic.sequenceId.slice(0, 8) : '?'}…
        </div>
      </div>`
    )
    .addTo(map);
}

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
