// Mapillary source adapter (#112 phase 2) — read-only street-level imagery
// through the Graph API v4. Free client token required (mapillary.com developer
// dashboard); their client-token model explicitly allows the token in a
// front-end-only app. Without a token the adapter is simply not registered.
//
// 360° content: `is_pano` images are equirectangular; `thumb_original_url`
// serves the full panorama. Image URLs are TIME-LIMITED CDN links — always
// fetched lazily, never persisted (SOURCES.md). Imagery license: CC-BY-SA 4.0,
// displayed as '© Mapillary' on the map attribution.
import { MAPILLARY_TOKEN, COVERAGE_MIN_ZOOM } from './config.js';

const GRAPH = 'https://graph.mapillary.com';
const COVERAGE_TILES = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}';
const FIELDS =
  'id,geometry,computed_geometry,compass_angle,computed_compass_angle,is_pano,' +
  'thumb_1024_url,thumb_2048_url,thumb_original_url,sequence,captured_at,creator';

export const SOURCE_ID = 'mapillary';
export const SEQUENCES_LAYER = 'mapillary-sequences';
export const PICTURES_LAYER = 'mapillary-pictures';

// --- Token resolution --------------------------------------------------------
// Order: ?mapillary_token= URL param (persisted for the session's later loads)
// → localStorage → the build-time config constant. Pure core, browser wrapper.
const TOKEN_STORE_KEY = 'mapmax:mapillary-token';

export function resolveToken({ urlParam, stored, configured } = {}) {
  return urlParam || stored || configured || '';
}

export function mapillaryToken() {
  let urlParam = null;
  let stored = null;
  try {
    urlParam = new URLSearchParams(globalThis.location?.search || '').get('mapillary_token');
    if (urlParam) globalThis.localStorage?.setItem(TOKEN_STORE_KEY, urlParam);
    stored = globalThis.localStorage?.getItem(TOKEN_STORE_KEY);
  } catch { /* no DOM (tests) or storage denied — config only */ }
  return resolveToken({ urlParam, stored, configured: MAPILLARY_TOKEN });
}

// --- Pure helpers (unit-tested offline) --------------------------------------

// Same bbox approximation as the Panoramax client: radiusM metres around a
// lon/lat, [minLon, minLat, maxLon, maxLat].
export function bboxAround(lon, lat, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

// Graph API node → MapMax's normalized picture (the shape normalizeItem()
// produces for Panoramax). computed_* fields are the SfM-corrected values —
// preferred over the camera-reported ones when present.
export function normalizeImage(node) {
  const geom = node.computed_geometry || node.geometry || {};
  const [lon, lat] = geom.coordinates || [undefined, undefined];
  const compass = node.computed_compass_angle ?? node.compass_angle;
  const type = node.is_pano ? 'equirectangular' : 'flat';
  return {
    id: String(node.id),
    source: 'mapillary',
    lon,
    lat,
    heading: Number.isFinite(compass) ? compass : 0,
    // Both compass fields are real headings (magnetometer or SfM-derived) —
    // unlike Panoramax's track-derived azimuths there is no mount ambiguity.
    hasCompass: Number.isFinite(compass),
    hfov: type === 'equirectangular' ? 360 : 70,
    type,
    sequenceId: node.sequence || null,
    rankInSequence: node.rankInSequence,
    nextId: null,
    prevId: null,
    // Time-limited CDN URLs — used straight away, never stored (SOURCES.md).
    assets: {
      hd: node.thumb_original_url,
      sd: node.thumb_2048_url,
      thumb: node.thumb_1024_url,
    },
    producer: node.creator?.username,
    license: 'CC-BY-SA-4.0',
    datetime: Number.isFinite(node.captured_at) ? new Date(node.captured_at).toISOString() : undefined,
    homeApi: null, // read-only: corrections have nowhere to go
    exifPose: {},
    tiles: null, // no tiled derivates → single-texture path
  };
}

// Reorder a batch-fetch result to a reference id order (the images endpoint
// does not guarantee it) and stamp the sequence rank.
export function orderLike(ids, nodes) {
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  return ids
    .map((id, i) => {
      const n = byId.get(String(id));
      return n ? { ...n, rankInSequence: i } : null;
    })
    .filter(Boolean);
}

// --- Graph API client --------------------------------------------------------

async function graph(path, params) {
  const q = new URLSearchParams({ ...params, access_token: mapillaryToken() });
  const res = await fetch(`${GRAPH}${path}?${q}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Mapillary API ${res.status} on ${path}`);
  return res.json();
}

export async function getPicture(id) {
  const node = await graph(`/${encodeURIComponent(id)}`, { fields: FIELDS });
  return normalizeImage(node);
}

export async function searchNearby(lon, lat, radiusM = 30, limit = 50) {
  const data = await graph('/images', {
    bbox: bboxAround(lon, lat, radiusM).join(','),
    fields: FIELDS,
    limit: String(limit),
  });
  return (data.data || []).map(normalizeImage);
}

// Capture-ordered sequence: image_ids gives the order, one batch images call
// recovers the metadata (kept to `limit` — the sun-compass vote samples ~10).
export async function getSequence(sequenceId, limit = 200) {
  const idData = await graph('/image_ids', { sequence_id: sequenceId });
  const ids = (idData.data || []).map((n) => String(n.id)).slice(0, limit);
  if (!ids.length) return [];
  const imgData = await graph('/images', { image_ids: ids.join(','), fields: FIELDS });
  return orderLike(ids, imgData.data || []).map(normalizeImage);
}

// --- Map coverage ------------------------------------------------------------

export function addMapillaryLayers(map) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [`${COVERAGE_TILES}?access_token=${encodeURIComponent(mapillaryToken())}`],
    minzoom: 0,
    maxzoom: 14,
    attribution: '© <a href="https://www.mapillary.com">Mapillary</a>, CC-BY-SA',
  });
  map.addLayer({
    id: SEQUENCES_LAYER,
    type: 'line',
    // No coverage below city zoom — keeps world/country views from fetching
    // the whole catalog's geometry (#122).
    minzoom: COVERAGE_MIN_ZOOM,
    source: SOURCE_ID,
    'source-layer': 'sequence',
    paint: {
      // Mapillary green — source-distinct from the Panoramax orange (#112).
      'line-color': '#05cb63',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3],
      'line-opacity': 0.75,
    },
  });
  map.addLayer({
    id: PICTURES_LAYER,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'image',
    // Dots at street scale only, like the Panoramax layer (#56 / LOD.md).
    minzoom: 17,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 17, 4, 22, 8],
      // 360° dots teal, flat frames green — never the Panoramax palette.
      'circle-color': ['case', ['==', ['get', 'is_pano'], true], '#00838f', '#05cb63'],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.9,
    },
  });
  for (const layer of [PICTURES_LAYER, SEQUENCES_LAYER]) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }
}

export function onPictureClick(map, handler) {
  map.on('click', PICTURES_LAYER, (e) => {
    const f = e.features && e.features[0];
    if (f) handler(String(f.properties.id), f);
  });
}

// The source adapter (#112) — read-only: no editing, no HD tiling; sequences
// exist for walking and the sun-compass corroboration.
export const mapillarySource = {
  id: 'mapillary',
  name: 'Mapillary',
  color: '#05cb63',
  // Same palette as the map dots: teal 360°s, green flats.
  dotColors: { equirectangular: '#00838f', flat: '#05cb63' },
  layers: [SEQUENCES_LAYER, PICTURES_LAYER],
  capabilities: { editable: false, hdTiles: false, sequences: true },
  addCoverage: addMapillaryLayers,
  onPictureClick,
  getPicture,
  searchNearby,
  getSequence,
};
