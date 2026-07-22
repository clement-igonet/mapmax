// Navigation arrows on the street surface: click one to move to that picture.
import { arrowsToGeoJSON, pickArrows } from './arrows.js';
import { getPicture, searchNearby } from './panoramax.js';
import { enterStreetView, onPictureChanged } from './streetview.js';

const SOURCE_ID = 'mapmax-nav-arrows';
const LAYER_ID = 'mapmax-nav-arrows';
const EMPTY = { type: 'FeatureCollection', features: [] };

let navigating = false;

export function setupNavigation(map) {
  onPictureChanged((pic) => {
    if (!pic) return clearArrows(map);
    refreshArrows(map, pic).catch((err) => console.error('arrows', err));
  });

  map.on('click', LAYER_ID, async (e) => {
    const f = e.features && e.features[0];
    if (!f || navigating) return;
    navigating = true;
    try {
      await navigateTo(map, f.properties.targetId);
    } catch (err) {
      console.error('navigate', err);
    } finally {
      navigating = false;
    }
  });
  map.on('mouseenter', LAYER_ID, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', LAYER_ID, () => (map.getCanvas().style.cursor = ''));
}

export async function navigateTo(map, pictureId) {
  const pic = await getPicture(pictureId);
  await enterStreetView(map, pic);
  return pic;
}

async function refreshArrows(map, pic) {
  ensureLayer(map);
  const candidates = await searchNearby(pic.lon, pic.lat, 35, 60);
  const arrows = pickArrows(pic, candidates);
  map.getSource(SOURCE_ID).setData(arrowsToGeoJSON(arrows));
}

function clearArrows(map) {
  map.getSource(SOURCE_ID)?.setData(EMPTY);
}

function ensureLayer(map) {
  if (!map.hasImage('nav-arrow')) map.addImage('nav-arrow', makeArrowImage(), { pixelRatio: 2 });
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(LAYER_ID)) {
    // icon-rotation/pitch alignment "map" makes the chevron lie flat on the
    // ground plane, pointing toward the target picture.
    map.addLayer({
      id: LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'icon-image': 'nav-arrow',
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 17, 0.6, 22, 1.4],
      },
      paint: {
        'icon-opacity': ['case', ['get', 'sameSequence'], 0.95, 0.75],
      },
    });
  }
}

// White chevron with a dark outline, drawn pointing north (up) so that
// icon-rotate can take the target bearing directly.
function makeArrowImage() {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(48, 10);
  ctx.lineTo(84, 62);
  ctx.lineTo(48, 46);
  ctx.lineTo(12, 62);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(20,40,90,0.9)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
