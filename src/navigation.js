// Navigation arrows on the street surface: click one to move to that picture.
import { arrowGlyphPoints, arrowsToGeoJSON, chooseByHeading, pickArrows } from './arrows.js';
import { STREET_POI_RADIUS_M } from './config.js';
import { distanceM } from './geo.js';
import { getPicture, searchNearby } from './panoramax.js';
import { currentPicture, enterStreetView, onPictureChanged } from './streetview.js';

const SOURCE_ID = 'mapmax-nav-arrows';
const LAYER_ID = 'mapmax-nav-arrows';
const POI_SOURCE_ID = 'mapmax-nearby-poi';
const POI_LAYER_ID = 'mapmax-nearby-poi';
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

// Walk toward `headingDeg` (keyboard advance): pick the ground arrow best
// aligned with where the user is looking and move to it (SPECIFICATIONS.md §2.5).
export async function advance(map, headingDeg) {
  const pic = currentPicture();
  if (!pic) return null;
  const candidates = await searchNearby(pic.lon, pic.lat, 35, 60);
  const arrow = chooseByHeading(pickArrows(pic, candidates), headingDeg);
  if (!arrow) return null;
  return navigateTo(map, arrow.targetId);
}

// Jump to the picture nearest a clicked map point (double-click-to-go).
export async function goToNearest(map, lngLat, maxMeters = 30) {
  const [lon, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
  const candidates = await searchNearby(lon, lat, maxMeters, 40);
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distanceM(lon, lat, c.lon, c.lat);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) return null;
  return enterStreetView(map, best);
}

async function refreshArrows(map, pic) {
  ensureLayer(map);
  // Only look within the street POI radius (#27): keeps the query light and the
  // shown POIs nearby. Arrows and nearby dots come from the same fetch.
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
  map.getSource(SOURCE_ID).setData(arrowsToGeoJSON(pickArrows(pic, candidates)));
  map.getSource(POI_SOURCE_ID).setData(nearbyPoiGeoJSON(pic, candidates));
}

// Nearby pictures within STREET_POI_RADIUS_M (excluding the current one), as a
// bounded GeoJSON with fixed dot radius — replaces the unbounded vector-tile
// POI layer while in street mode, so nothing far or oversized shows (#27).
function nearbyPoiGeoJSON(current, candidates) {
  return {
    type: 'FeatureCollection',
    features: candidates
      .filter((c) => c.id !== current.id &&
        distanceM(current.lon, current.lat, c.lon, c.lat) <= STREET_POI_RADIUS_M)
      .map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { id: c.id, type: c.type },
      })),
  };
}

function clearArrows(map) {
  map.getSource(SOURCE_ID)?.setData(EMPTY);
  map.getSource(POI_SOURCE_ID)?.setData(EMPTY);
}

function ensureLayer(map) {
  if (!map.hasImage('nav-arrow')) map.addImage('nav-arrow', makeArrowImage(), { pixelRatio: 2 });
  if (!map.getSource(POI_SOURCE_ID)) map.addSource(POI_SOURCE_ID, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(POI_LAYER_ID)) {
    map.addLayer({
      id: POI_LAYER_ID,
      type: 'circle',
      source: POI_SOURCE_ID,
      paint: {
        'circle-radius': 4,
        'circle-color': ['case', ['==', ['get', 'type'], 'equirectangular'], '#2962ff', '#ff6f00'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.9,
        'circle-pitch-alignment': 'map',
      },
    });
    map.on('click', POI_LAYER_ID, (e) => {
      const f = e.features && e.features[0];
      if (f) navigateTo(map, f.properties.id).catch((err) => console.error('poi nav', err));
    });
  }
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
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Clamp with min/max so the glyph never blows up at street-level zoom (#26).
        'icon-size': ['interpolate', ['linear'], ['zoom'], 17, 0.35, 20, 0.6, 22, 0.6],
      },
      paint: {
        'icon-opacity': ['case', ['get', 'sameSequence'], 0.95, 0.75],
      },
    });
  }
}

// White chevron with a dark outline, centered with padding so it is never
// clipped by its own icon bounds (#26). Drawn pointing north (up) so that
// icon-rotate can take the target bearing directly.
function makeArrowImage() {
  const size = 128;
  const pad = 14;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round';
  const pts = arrowGlyphPoints(size, pad);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(20,40,90,0.9)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
