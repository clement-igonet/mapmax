// Panoramax API client + map layers (sequences and picture points).
import { PANORAMAX_API } from './config.js';

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
    minzoom: 14,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 7],
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

const idFromHref = (href) => {
  const m = href && href.match(/\/items\/([0-9a-f-]+)/i);
  return m ? m[1] : null;
};

function normalizeItem(f) {
  const p = f.properties || {};
  const links = f.links || [];
  const io = p['pers:interior_orientation'] || {};
  const type =
    io.field_of_view === 360 || p['pano'] === true ? 'equirectangular'
    : io.field_of_view ? 'flat'
    : guessTypeFromAssets(f);
  return {
    id: f.id,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    heading: p['view:azimuth'] ?? 0,
    hfov: io.field_of_view || (type === 'equirectangular' ? 360 : 70),
    type,
    sequenceId: f.collection,
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
  };
}

// Heuristic when the API gives no field of view: equirectangular derivates
// are produced for 360 pictures; a 2:1 sensor ratio is also a strong hint.
function guessTypeFromAssets(f) {
  const dims = f.properties?.['pers:interior_orientation']?.sensor_array_dimensions;
  if (dims && dims.length === 2 && Math.abs(dims[0] / dims[1] - 2) < 0.05) return 'equirectangular';
  return 'flat';
}

export async function getPicture(id) {
  const data = await stac(`/search?ids=${encodeURIComponent(id)}`);
  const f = data.features && data.features[0];
  if (!f) throw new Error(`Picture ${id} not found`);
  return normalizeItem(f);
}

// Pictures within `radiusM` meters around lon/lat (bbox approximation).
export async function searchNearby(lon, lat, radiusM = 30, limit = 50) {
  const dLat = radiusM / 111320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(',');
  const data = await stac(`/search?bbox=${bbox}&limit=${limit}`);
  return (data.features || []).map(normalizeItem);
}
