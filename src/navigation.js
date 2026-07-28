// Navigation between photospheres, rendered INTO the panorama (incrusted GL
// ground layers on the road), pointing to neighbouring 360° photospheres and
// clickable to walk there.
//
// Since #7932 (vendored MapLibre) ground symbol/circle layers render correctly
// on the road even at eye-level pitch. queryRenderedFeatures is still unreliable
// at that pitch, so hit-testing (click + hover cursor) is done in SCREEN space
// via map.project() of each feature — robust at any pitch.
import { chooseByHeading, groundArrowPolygon, pickArrows } from './arrows.js';
import { STREET_POI_RADIUS_M } from './config.js';
import { distanceM, isDragGesture } from './geo.js';
import { getPicture, searchNearby } from './panoramax.js';
import { currentPicture, enterStreetView, isStreetMode, onPictureChanged } from './streetview.js';

const ARROW_SRC = 'mapmax-nav-arrows';
const ARROW_LAYER = 'mapmax-nav-arrows';
const POI_SRC = 'mapmax-nav-poi';
const POI_LAYER = 'mapmax-nav-poi';
const EMPTY = { type: 'FeatureCollection', features: [] };
const HIT_PX = 26; // click/hover tolerance around a feature's screen point

let arrows = []; // [{ lngLat:[lon,lat], targetId, bearing }]
let pois = []; //   [{ lngLat:[lon,lat], id }]
let navigating = false;
let downPoint = null;

export function setupNavigation(map) {
  onPictureChanged((pic) => {
    if (!pic) return clearNav(map);
    refresh(map, pic).catch((err) => console.error('nav', err));
  });

  map.on('mousedown', (e) => (downPoint = e.point));

  map.on('click', (e) => {
    if (!isStreetMode() || navigating) return;
    if (downPoint && isDragGesture(downPoint.x, downPoint.y, e.point.x, e.point.y)) return; // look-drag
    const hit = nearestHit(map, e.point);
    if (hit) go(map, hit);
  });

  map.on('mousemove', (e) => {
    if (!isStreetMode()) return;
    map.getCanvas().style.cursor = nearestHit(map, e.point) ? 'pointer' : '';
  });
}

// The clickable target whose projected screen position is closest to `point`,
// within HIT_PX — arrows first (they sit on the near road), then POI dots.
function nearestHit(map, point) {
  let best = null;
  let bestD = HIT_PX;
  for (const a of arrows) {
    const d = screenDist(map, a.lngLat, point);
    if (d < bestD) { bestD = d; best = a.targetId; }
  }
  for (const p of pois) {
    const d = screenDist(map, p.lngLat, point);
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return best;
}

function screenDist(map, lngLat, point) {
  const p = map.project(lngLat);
  return Math.hypot(p.x - point.x, p.y - point.y);
}

async function refresh(map, pic) {
  ensureLayers(map);
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
  // Only route to 360° panoramas (flat pictures can't be a photosphere yet, #40).
  const pano = candidates.filter((c) => c.type === 'equirectangular');
  arrows = pickArrows(pic, pano).map((a) => ({ lngLat: [a.lon, a.lat], targetId: a.targetId, bearing: a.bearing }));
  pois = pano
    .filter((c) => c.id !== pic.id && distanceM(pic.lon, pic.lat, c.lon, c.lat) <= STREET_POI_RADIUS_M)
    .map((c) => ({ lngLat: [c.lon, c.lat], id: c.id }));
  map.getSource(ARROW_SRC).setData({
    type: 'FeatureCollection',
    features: arrows.map((a) => ({
      type: 'Feature',
      // Real ground geometry (fill polygon), not a billboard icon: it renders as
      // continuous ground and is never clipped like a foreshortened icon quad
      // near the camera (#26).
      geometry: { type: 'Polygon', coordinates: groundArrowPolygon(a.lngLat[0], a.lngLat[1], a.bearing, 1.4) },
      properties: {},
    })),
  });
  map.getSource(POI_SRC).setData({
    type: 'FeatureCollection',
    features: pois.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.lngLat }, properties: {} })),
  });
}

function clearNav(map) {
  arrows = [];
  pois = [];
  map.getSource(ARROW_SRC)?.setData(EMPTY);
  map.getSource(POI_SRC)?.setData(EMPTY);
  map.getCanvas().style.cursor = '';
}

function ensureLayers(map) {
  // POI dots first, arrows on top — both above the photosphere custom layer
  // (added later than it), so they draw incrusted over the panorama.
  if (!map.getSource(POI_SRC)) map.addSource(POI_SRC, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(POI_LAYER)) {
    map.addLayer({
      id: POI_LAYER,
      type: 'circle',
      source: POI_SRC,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 17, 4, 22, 9],
        'circle-color': '#2962ff',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
        'circle-pitch-alignment': 'map', // lie on the road (incrusted)
      },
    });
  }
  if (!map.getSource(ARROW_SRC)) map.addSource(ARROW_SRC, { type: 'geojson', data: EMPTY });
  if (!map.getLayer(ARROW_LAYER)) {
    // Fill polygon draped on the road (real ground geometry) — never clipped
    // like a billboard icon near the camera (#26).
    map.addLayer({
      id: ARROW_LAYER,
      type: 'fill',
      source: ARROW_SRC,
      paint: {
        'fill-color': '#ffffff',
        'fill-outline-color': 'rgba(20,40,90,0.9)',
        'fill-opacity': 0.9,
      },
    });
  }
}

function go(map, id) {
  if (navigating) return;
  navigating = true;
  navigateTo(map, id)
    .catch((err) => console.error('navigate', err))
    .finally(() => { navigating = false; });
}

export async function navigateTo(map, pictureId) {
  const pic = await getPicture(pictureId);
  await enterStreetView(map, pic);
  return pic;
}

// Walk toward `headingDeg` (keyboard advance): the arrow best aligned with the
// look direction (SPECIFICATIONS.md §2.5).
export async function advance(map, headingDeg) {
  const pic = currentPicture();
  if (!pic) return null;
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
  const pano = candidates.filter((c) => c.type === 'equirectangular');
  const arrow = chooseByHeading(pickArrows(pic, pano), headingDeg);
  if (!arrow) return null;
  return navigateTo(map, arrow.targetId);
}

// Jump to the picture nearest a clicked map point (double-click-to-go helper).
export async function goToNearest(map, lngLat, maxMeters = 30) {
  const [lon, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
  const candidates = await searchNearby(lon, lat, maxMeters, 40);
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.type !== 'equirectangular') continue;
    const d = distanceM(lon, lat, c.lon, c.lat);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  return enterStreetView(map, best);
}

// Test/introspection helpers.
export const _navCounts = () => ({ arrows: arrows.length, poi: pois.length });
export const _navArrows = () => arrows;
