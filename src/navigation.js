// Navigation arrows on the street surface: click one to move to that picture.
import { arrowsToGeoJSON, chooseByHeading, pickArrows } from './arrows.js';
import { STREET_POI_RADIUS_M } from './config.js';
import { distanceM, isDragGesture } from './geo.js';
import { getPicture, searchNearby } from './panoramax.js';
import { currentPicture, enterStreetView, onPictureChanged } from './streetview.js';

const SOURCE_ID = 'mapmax-nav-arrows';
const LAYER_ID = 'mapmax-nav-arrows';
const POI_SOURCE_ID = 'mapmax-nearby-poi';
const POI_LAYER_ID = 'mapmax-nearby-poi';
const EMPTY = { type: 'FeatureCollection', features: [] };

let navigating = false;
let downPoint = null; // pointer position at mousedown, to detect look-drags (#32)

// A click ends a look-drag when the pointer moved more than a few px since
// mousedown — such clicks must NOT navigate (#32).
const wasLookDrag = (e) =>
  !!downPoint && isDragGesture(downPoint.x, downPoint.y, e.point.x, e.point.y);

export function setupNavigation(map) {
  onPictureChanged((pic) => {
    if (!pic) return clearArrows(map);
    refreshArrows(map, pic).catch((err) => console.error('arrows', err));
  });

  map.on('mousedown', (e) => (downPoint = e.point));

  map.on('click', LAYER_ID, async (e) => {
    const f = e.features && e.features[0];
    if (!f || navigating || wasLookDrag(e)) return;
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
  if (!map.getSource(POI_SOURCE_ID)) map.addSource(POI_SOURCE_ID, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(POI_LAYER_ID)) {
    // Screen-aligned (viewport) dots: the visible circle == the hittable area,
    // so hover changes the cursor and clicks land reliably (#33).
    map.addLayer({
      id: POI_LAYER_ID,
      type: 'circle',
      source: POI_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', ['==', ['get', 'type'], 'equirectangular'], '#2962ff', '#ff6f00'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    });
    map.on('click', POI_LAYER_ID, async (e) => {
      const f = e.features && e.features[0];
      if (!f || navigating || wasLookDrag(e)) return;
      navigating = true;
      try {
        await navigateTo(map, f.properties.id);
      } catch (err) {
        console.error('poi nav', err);
      } finally {
        navigating = false;
      }
    });
    map.on('mouseenter', POI_LAYER_ID, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', POI_LAYER_ID, () => (map.getCanvas().style.cursor = ''));
  }
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(LAYER_ID)) {
    // Ground arrow = real polygon geometry draped on the street (fill), so it
    // is never clipped like a foreshortened billboard icon at grazing pitch (#26).
    map.addLayer({
      id: LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': '#ffffff',
        'fill-outline-color': 'rgba(20,40,90,0.9)',
        'fill-opacity': ['case', ['get', 'sameSequence'], 0.9, 0.65],
      },
    });
  }
}
