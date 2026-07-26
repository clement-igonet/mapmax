// Navigation between photospheres, rendered as DOM markers (maplibregl.Marker)
// rather than WebGL layers. At the very-low street camera + high pitch,
// MapLibre near-plane-clips ground geometry and its feature query returns
// nothing, so fill/circle layers looked cropped and weren't hoverable/clickable
// (#26, #33, and the "navigation blocked" reports). DOM markers are never
// near-plane-clipped, are natively hoverable/clickable, and — with map
// alignment — the arrows still lie on the street pointing toward the target.
import { Marker } from 'maplibre-gl';
import { chooseByHeading, pickArrows } from './arrows.js';
import { STREET_POI_RADIUS_M } from './config.js';
import { distanceM, isDragGesture } from './geo.js';
import { getPicture, searchNearby } from './panoramax.js';
import { currentPicture, enterStreetView, onPictureChanged } from './streetview.js';

let arrowMarkers = [];
let poiMarkers = [];
let navigating = false;

export function setupNavigation(map) {
  onPictureChanged((pic) => {
    if (!pic) return clearMarkers();
    refresh(map, pic).catch((err) => console.error('nav', err));
  });
}

function clearMarkers() {
  for (const m of arrowMarkers) m.remove();
  for (const m of poiMarkers) m.remove();
  arrowMarkers = [];
  poiMarkers = [];
}

// Rebuild arrows + nearby POI markers around the current picture, bounded to
// STREET_POI_RADIUS_M (#27) — the same fetch feeds both.
async function refresh(map, pic) {
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
  clearMarkers();
  for (const a of pickArrows(pic, candidates)) {
    arrowMarkers.push(makeArrowMarker(map, a));
  }
  for (const c of candidates) {
    if (c.id === pic.id) continue;
    if (distanceM(pic.lon, pic.lat, c.lon, c.lat) > STREET_POI_RADIUS_M) continue;
    poiMarkers.push(makePoiMarker(map, c));
  }
}

function go(map, id) {
  if (navigating) return;
  navigating = true;
  navigateTo(map, id)
    .catch((err) => console.error('navigate', err))
    .finally(() => { navigating = false; });
}

// A click that ends a >6px drag is a look-around, not a tap — don't navigate (#32).
function onTapNotDrag(el, handler) {
  let down = null;
  el.addEventListener('mousedown', (e) => { down = [e.clientX, e.clientY]; });
  el.addEventListener('click', (e) => {
    if (down && isDragGesture(down[0], down[1], e.clientX, e.clientY)) return;
    handler();
  });
}

function makeArrowMarker(map, a) {
  const el = document.createElement('div');
  el.className = 'nav-arrow';
  el.title = 'Walk here';
  el.innerHTML =
    '<svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">' +
    '<polygon points="20,3 37,37 20,28 3,37" fill="#ffffff" ' +
    'stroke="rgba(20,40,90,0.9)" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  onTapNotDrag(el, () => go(map, a.targetId));
  // Map-aligned so the chevron lies on the street and points toward the target.
  return new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map', rotation: a.bearing })
    .setLngLat([a.lon, a.lat])
    .addTo(map);
}

function makePoiMarker(map, c) {
  const el = document.createElement('div');
  el.className = 'nav-poi';
  el.title = 'Go to this picture';
  el.style.background = c.type === 'equirectangular' ? '#2962ff' : '#ff6f00';
  onTapNotDrag(el, () => go(map, c.id));
  return new Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map);
}

export async function navigateTo(map, pictureId) {
  const pic = await getPicture(pictureId);
  await enterStreetView(map, pic);
  return pic;
}

// Walk toward `headingDeg` (keyboard advance): pick the arrow best aligned with
// where the user is looking and move to it (SPECIFICATIONS.md §2.5).
export async function advance(map, headingDeg) {
  const pic = currentPicture();
  if (!pic) return null;
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
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

// Test/introspection helper.
export const _markerCounts = () => ({ arrows: arrowMarkers.length, poi: poiMarkers.length });
