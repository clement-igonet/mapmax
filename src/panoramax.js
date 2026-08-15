// Panoramax API client + map layers (sequences and picture points).
import { PANORAMAX_API, COVERAGE_MIN_ZOOM } from './config.js';
import { homeApiBase, readPoseFromExif } from './pose.js';

export const SOURCE_ID = 'panoramax';
export const SEQUENCES_LAYER = 'panoramax-sequences';
export const PICTURES_LAYER = 'panoramax-pictures';

// --- Map layers -------------------------------------------------------------

export function addPanoramaxLayers(map) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [`${PANORAMAX_API}/map/{z}/{x}/{y}.mvt`],
    minzoom: 0,
    maxzoom: 15,
    attribution: '© <a href="https://panoramax.fr">Panoramax</a> contributors',
  });
  map.addLayer({
    id: SEQUENCES_LAYER,
    type: 'line',
    // No coverage below city zoom — keeps world/country views from fetching
    // the whole catalog's geometry (#122).
    minzoom: COVERAGE_MIN_ZOOM,
    source: SOURCE_ID,
    'source-layer': 'sequences',
    paint: {
      'line-color': '#ff6f00',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3],
      'line-opacity': 0.75,
    },
  });
  map.addLayer({
    id: PICTURES_LAYER,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'pictures',
    // Individual picture dots only at street scale — at z16 the whole city of
    // points renders at once (tens of MB). Sequence lines cover the overview;
    // dots appear when you're zoomed in enough to click one (#56, see LOD.md).
    minzoom: 17,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 17, 4, 22, 8],
      'circle-color': ['case', ['==', ['get', 'type'], 'equirectangular'], '#2962ff', '#ff6f00'],
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
    if (f) handler(f.properties.id, f);
  });
}

// --- STAC API ---------------------------------------------------------------

async function stac(path) {
  const res = await fetch(`${PANORAMAX_API}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Panoramax API ${res.status} on ${path}`);
  return res.json();
}

export const idFromHref = (href) => {
  const m = href && href.match(/\/items\/([0-9a-f-]+)/i);
  return m ? m[1] : null;
};

// Tiled HD derivate (STAC tiled-assets) → the photosphere plugin's `tiles`
// config for progressive refinement (plugin 0.3.0+). The meta-catalog includes
// these fields on /collections/:id/items but STRIPS them from /search — pics
// from a search need fetchTilesConfig() before entering.
export function tilesFromStac(f) {
  const matrix = f?.properties?.['tiles:tile_matrix_sets']?.geovisio?.tileMatrix?.[0];
  const template = (f?.asset_templates?.tiles_webp || f?.asset_templates?.tiles)?.href;
  if (!matrix || !template) return null;
  return {
    width: Math.round(matrix.matrixWidth * matrix.tileWidth),
    cols: matrix.matrixWidth,
    rows: matrix.matrixHeight,
    url: (col, row) => template.replace(/\{TileCol\}/g, col).replace(/\{TileRow\}/g, row),
  };
}

// One small item fetch to recover the tiles config a /search result lacks.
export async function fetchTilesConfig(pic) {
  if (!pic?.sequenceId || !pic?.id) return null;
  const f = await stac(`/collections/${encodeURIComponent(pic.sequenceId)}/items/${encodeURIComponent(pic.id)}`);
  return tilesFromStac(f);
}

export function normalizeItem(f) {
  const p = f.properties || {};
  const links = f.links || [];
  const io = p['pers:interior_orientation'] || {};
  // A full photosphere is claimed ONLY on authoritative 360° metadata: the GPano
  // equirectangular projection tag, a ~360° field of view, or the STAC `pano`
  // flag. A 2:1 sensor ratio is deliberately NOT accepted — flat wide-camera
  // frames (e.g. 3168×1584) are also exactly 2:1, indistinguishable from a real
  // pano (5640×2820) by ratio, so it produced false spheres (#40). Anything
  // without that metadata is 'flat' and is placed as a patch (#46/#47), never
  // stretched across the whole sphere.
  const gpano = p.exif && p.exif['Xmp.GPano.ProjectionType'];
  const fov = io.field_of_view;
  const type =
    gpano === 'equirectangular' ? 'equirectangular'
    : (typeof fov === 'number' && fov >= 355) || p['pano'] === true ? 'equirectangular'
    : 'flat';
  return {
    id: f.id,
    source: 'panoramax',
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    heading: p['view:azimuth'] ?? 0,
    // True when the camera wrote a magnetometer heading — then view:azimuth is
    // the real image-centre direction. Absent, it is track-derived (travel
    // direction) and the mount may face anywhere → sun-compass check (#66).
    hasCompass: !!(p.exif && p.exif['Exif.GPSInfo.GPSImgDirection']),
    hfov: io.field_of_view || (type === 'equirectangular' ? 360 : 70),
    type,
    sequenceId: f.collection,
    rankInSequence: p['geovisio:rank_in_collection'],
    nextId: idFromHref((links.find((l) => l.rel === 'next') || {}).href),
    prevId: idFromHref((links.find((l) => l.rel === 'prev') || {}).href),
    assets: {
      hd: f.assets?.hd?.href,
      sd: f.assets?.sd?.href,
      thumb: f.assets?.thumb?.href || p['geovisio:thumbnail'],
    },
    producer: p['geovisio:producer'],
    license: p.license,
    datetime: p.datetime,
    // Pose corrector (#98): the owning instance's API (PATCH must not go to the
    // read-only meta-catalog) and any camera-written capture pose.
    homeApi: homeApiBase(links, (links.find((l) => l.rel === 'self') || {}).href),
    exifPose: readPoseFromExif(p.exif),
    // Progressive HD refinement (plugin 0.3.0): present on items-list results,
    // null on /search results (fetchTilesConfig recovers it).
    tiles: tilesFromStac(f),
  };
}

export async function getPicture(id) {
  const data = await stac(`/search?ids=${encodeURIComponent(id)}`);
  const f = data.features && data.features[0];
  if (!f) throw new Error(`Picture ${id} not found`);
  return normalizeItem(f);
}

// The source adapter (#112) — the interface documented in sources.js, backed
// by the functions above (which stay exported for the unit tests).
export const panoramaxSource = {
  id: 'panoramax',
  name: 'Panoramax',
  color: '#ff6f00',
  // Same palette as the map dots: blue 360°s, orange flats.
  dotColors: { equirectangular: '#2962ff', flat: '#ff6f00' },
  layers: [SEQUENCES_LAYER, PICTURES_LAYER],
  capabilities: { editable: true, hdTiles: true, sequences: true },
  addCoverage: addPanoramaxLayers,
  onPictureClick,
  getPicture,
  searchNearby,
  getSequence,
  fetchTilesConfig,
};

// Pictures within `radiusM` meters around lon/lat (bbox approximation).
export async function searchNearby(lon, lat, radiusM = 30, limit = 50) {
  const dLat = radiusM / 111320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(',');
  const data = await stac(`/search?bbox=${bbox}&limit=${limit}`);
  return (data.features || []).map(normalizeItem);
}

// A whole street in capture order: a Panoramax collection is a sequence.
export async function getSequence(collectionId, limit = 200) {
  const data = await stac(`/collections/${collectionId}/items?limit=${limit}`);
  return (data.features || [])
    .map(normalizeItem)
    .sort((a, b) => (a.rankInSequence ?? 0) - (b.rankInSequence ?? 0));
}
