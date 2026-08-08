// Navigation between photospheres.
//
// Both the ground ARROWS (walk targets) and the neighbour-panorama DOTS are
// rendered INSIDE the photosphere's WebGL layer (see the plugin's
// setNavArrows / setNavPois / groundPick): drawn flat on the floor plane they
// cover the whole viewport and are never clipped or blown up by MapLibre's
// map-plane near clip at grazing pitch — the "cropped / giant blob" is
// impossible there (#26, #39). Clicks/hover hit-test via the same floor
// ray-cast (queryRenderedFeatures is unreliable at eye-level pitch).
import { chooseByHeading, pickArrows } from './arrows.js';
import { STREET_POI_RADIUS_M } from './config.js';
import { bearingBetween, distanceM, isDragGesture } from './geo.js';
import { getPicture, searchNearby } from './panoramax.js';
import { offsetLngLat } from './pose.js';
import { _photosphere, currentPicture, enterStreetView, getCurrentPositionOffset, isStreetMode, onPictureChanged, onPositionChanged } from './streetview.js';

const MAX_POIS = 12; // must match the plugin's shader POI cap
let arrows = []; // [{ bearing, targetId }]
let pois = []; //   [{ east, north, id }] ground offsets from the eye (m)
let navCache = null; // { pic, pano } — last fetch, re-derivable per position edit
let navigating = false;
let downPoint = null;

export function setupNavigation(map) {
  onPictureChanged((pic) => {
    if (!pic) return clearNav(map);
    refresh(map, pic).catch((err) => console.error('nav', err));
  });
  // A position edit (#107) moves the EYE: the dots/arrows sit at fixed world
  // positions, so their eye-relative metre offsets must be re-derived — no
  // network, the neighbour list is cached.
  onPositionChanged(() => {
    if (isStreetMode()) rebuildNav();
  });

  map.on('mousedown', (e) => (downPoint = e.point));

  map.on('click', (e) => {
    if (!isStreetMode() || navigating) return;
    if (downPoint && isDragGesture(downPoint.x, downPoint.y, e.point.x, e.point.y)) return; // look-drag
    const id = _photosphere()?.groundPick?.(e.point.x, e.point.y);
    if (id) go(map, id);
  });

  map.on('mousemove', (e) => {
    if (!isStreetMode()) return;
    map.getCanvas().style.cursor = _photosphere()?.groundPick?.(e.point.x, e.point.y) ? 'pointer' : '';
  });
}

// A neighbour picture's ground offset from the eye, in metres (east, north) —
// the frame the plugin's floor shader / ray-cast use.
function groundOffset(pic, c) {
  const dist = distanceM(pic.lon, pic.lat, c.lon, c.lat);
  const br = bearingBetween(pic.lon, pic.lat, c.lon, c.lat) * Math.PI / 180;
  return { east: dist * Math.sin(br), north: dist * Math.cos(br), id: c.id };
}

// The eye may not sit at the picture's GPS position: a position edit (#107)
// moves it. All eye-relative derivations use this corrected stand-point.
function effectiveEye(pic) {
  const o = getCurrentPositionOffset();
  if (!o || (!o.e && !o.n)) return pic;
  const [lon, lat] = offsetLngLat(pic.lon, pic.lat, o.e, o.n);
  return { ...pic, lon, lat };
}

async function refresh(map, pic) {
  const candidates = await searchNearby(pic.lon, pic.lat, STREET_POI_RADIUS_M, 60);
  // Only route to 360° panoramas (flat pictures can't be a photosphere yet, #40).
  navCache = { pic, pano: candidates.filter((c) => c.type === 'equirectangular') };
  rebuildNav();
}

function rebuildNav() {
  if (!navCache) return;
  const { pic, pano } = navCache;
  const eye = effectiveEye(pic);
  arrows = pickArrows(eye, pano).map((a) => ({ bearing: a.bearing, targetId: a.targetId }));
  // Nearest neighbours first, capped to the shader's MAX_POIS (keeps the count we
  // report equal to the count we render, and the floor uncluttered).
  pois = pano
    .filter((c) => c.id !== pic.id)
    .map((c) => ({ ...groundOffset(eye, c), dist: distanceM(eye.lon, eye.lat, c.lon, c.lat) }))
    .filter((p) => p.dist <= STREET_POI_RADIUS_M)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_POIS)
    .map(({ east, north, id }) => ({ east, north, id }));
  const ps = _photosphere();
  ps?.setNavArrows?.(arrows.map((a) => ({ bearing: a.bearing, id: a.targetId })));
  ps?.setNavPois?.(pois);
}

function clearNav(map) {
  arrows = [];
  pois = [];
  navCache = null;
  const ps = _photosphere();
  ps?.setNavArrows?.([]);
  ps?.setNavPois?.([]);
  map.getCanvas().style.cursor = '';
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
