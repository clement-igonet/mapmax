// Wikimedia Commons source adapter (#112 phase 3) — POI spheres: files tagged
// {{Pano360}} (Category:360° panoramas), tokenless via the MediaWiki API
// (origin=* CORS). The niche street coverage never captures: inside a
// cathedral, a summit view, a museum hall.
//
// Search combines CirrusSearch filters — `incategory:"360° panoramas"` +
// `nearcoord:<r>m,<lat>,<lon>` — so ONLY 360° files come back (geosearch alone
// cannot filter by category and would return every geotagged photo).
// License is PER FILE (CC0 / CC-BY / CC-BY-SA…): always displayed from
// extmetadata, never assumed. No sequences, no tiled derivates, usually no
// heading — the local 🔧 Adjust (editable capability) is how a mis-oriented
// sphere gets fixed, per picture, in localStorage.
import { COVERAGE_MIN_ZOOM } from './config.js';
import { distanceM } from './geo.js';

const API = 'https://commons.wikimedia.org/w/api.php';

export const SOURCE_ID = 'commons';
export const PICTURES_LAYER = 'commons-pictures';

// --- Pure helpers (unit-tested offline) --------------------------------------

export const stripHtml = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : undefined);

export function searchParams(lon, lat, radiusM, limit = 50, { coordsOnly = false } = {}) {
  const p = {
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `incategory:"360° panoramas" nearcoord:${Math.max(10, Math.round(radiusM))}m,${lat},${lon}`,
    gsrnamespace: '6',
    gsrlimit: String(Math.max(1, Math.min(limit, 100))),
    prop: coordsOnly ? 'coordinates' : 'coordinates|imageinfo',
  };
  if (!coordsOnly) {
    p.iiprop = 'url|size|extmetadata';
    p.iiurlwidth = '2048';
  }
  return p;
}

// MediaWiki page (generator=search + coordinates|imageinfo) → normalized pic.
export function normalizePage(page) {
  const ii = page.imageinfo?.[0] || {};
  const em = ii.extmetadata || {};
  const c = page.coordinates?.[0] || {};
  const cats = em.Categories?.value || '';
  // Everything reached through our search IS in the 360° category; a page
  // fetched by bare id keeps the check when metadata is present.
  const type = !cats || /360.*panoram/i.test(cats) ? 'equirectangular' : 'flat';
  return {
    id: String(page.pageid),
    source: 'commons',
    lon: c.lon,
    lat: c.lat,
    heading: 0, // Commons files rarely carry one — 🔧 Adjust fixes it locally
    hasCompass: false,
    hfov: type === 'equirectangular' ? 360 : 70,
    type,
    sequenceId: null,
    rankInSequence: undefined,
    nextId: null,
    prevId: null,
    assets: {
      hd: ii.url,
      sd: ii.thumburl || ii.url, // iiurlwidth=2048 rendition
      thumb: ii.thumburl,
    },
    producer: stripHtml(em.Artist?.value),
    license: em.LicenseShortName?.value, // PER FILE — never assumed
    datetime: em.DateTimeOriginal?.value || ii.timestamp,
    homeApi: null,
    exifPose: {},
    tiles: null,
    alt: undefined,
    title: page.title,
  };
}

// --- MediaWiki API client ----------------------------------------------------

async function mw(params) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const data = await res.json();
  return Object.values(data?.query?.pages || {});
}

export async function getPicture(id) {
  const pages = await mw({
    action: 'query',
    format: 'json',
    origin: '*',
    pageids: String(id),
    prop: 'coordinates|imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '2048',
  });
  if (!pages.length) throw new Error(`Commons picture ${id} not found`);
  return normalizePage(pages[0]);
}

export async function searchNearby(lon, lat, radiusM = 30, limit = 50) {
  const pages = await mw(searchParams(lon, lat, radiusM, limit));
  return pages.filter((p) => p.coordinates?.length).map(normalizePage);
}

// --- Map coverage ------------------------------------------------------------
// No worldwide tiles exist for "geotagged Pano360 files" — coverage is a
// live geosearch around the viewport, refreshed on moveend at city zoom and
// closer (#122 stays honored: nothing is fetched below COVERAGE_MIN_ZOOM).

const EMPTY = { type: 'FeatureCollection', features: [] };
let refreshSeq = 0;

async function refreshCoverage(map) {
  const src = map.getSource(SOURCE_ID);
  if (!src) return;
  if (map.getZoom() < COVERAGE_MIN_ZOOM) {
    src.setData(EMPTY);
    return;
  }
  const seq = ++refreshSeq;
  const c = map.getCenter();
  const b = map.getBounds();
  const radius = Math.min(10000, Math.round(distanceM(c.lng, c.lat, b.getEast(), b.getNorth())));
  try {
    const pages = await mw(searchParams(c.lng, c.lat, radius, 100, { coordsOnly: true }));
    if (seq !== refreshSeq) return; // a newer viewport superseded this fetch
    src.setData({
      type: 'FeatureCollection',
      features: pages
        .filter((p) => p.coordinates?.length)
        .map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.coordinates[0].lon, p.coordinates[0].lat] },
          properties: { id: String(p.pageid) },
        })),
    });
  } catch { /* transient API failure — keep the previous dots */ }
}

export function addCommonsLayers(map) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY, attribution: '© <a href="https://commons.wikimedia.org">Wikimedia Commons</a> contributors' });
  map.addLayer({
    id: PICTURES_LAYER,
    type: 'circle',
    source: SOURCE_ID,
    minzoom: COVERAGE_MIN_ZOOM,
    paint: {
      // Purple — the Commons 360° POI color, distinct from every other source.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 17, 5, 22, 9],
      'circle-color': '#8e24aa',
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.9,
    },
  });
  map.on('mouseenter', PICTURES_LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', PICTURES_LAYER, () => (map.getCanvas().style.cursor = ''));
  let t = 0;
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(() => refreshCoverage(map), 400);
  });
  refreshCoverage(map);
}

export function onPictureClick(map, handler) {
  map.on('click', PICTURES_LAYER, (e) => {
    const f = e.features && e.features[0];
    if (f) handler(String(f.properties.id), f);
  });
}

// The source adapter (#112). editable: heading is usually missing on Commons —
// the local 🔧 Adjust (localStorage, per picture) is the fix path.
export const commonsSource = {
  id: 'commons',
  name: 'Commons',
  color: '#8e24aa',
  // 360° only by construction (the category search) — no flat swatch.
  dotColors: { equirectangular: '#8e24aa' },
  layers: [PICTURES_LAYER],
  capabilities: { editable: true, hdTiles: false, sequences: false },
  addCoverage: addCommonsLayers,
  onPictureClick,
  getPicture,
  searchNearby,
};
