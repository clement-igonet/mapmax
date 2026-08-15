// Source-adapter registry (#112, phase 1) — MapMax browses 360° imagery from
// pluggable sources; the viewer itself is source-agnostic (a photosphere
// target is just {lngLat, imageUrl, bearing, tiles?}).
//
// An adapter is a plain object:
//   id            stable key ('panoramax', 'mapillary', …); every normalized
//                 picture carries it back as `pic.source`
//   name          human label for attribution / UI
//   capabilities  { editable, hdTiles, sequences } — consumers gate on these,
//                 they never special-case a source id
//   addCoverage(map)             map layers + attribution for the source
//   onPictureClick(map, handler) click on its coverage → handler(id, feature)
//   getPicture(id)               → normalized picture
//   searchNearby(lon, lat, radiusM, limit) → [normalized]
//   getSequence(seqId, limit)    → [normalized] (only if capabilities.sequences)
//   fetchTilesConfig(pic)        → tiles config | null (only if capabilities.hdTiles)
//
// A normalized picture minimally carries {id, source, lon, lat, heading, type,
// assets: {hd?, sd?, thumb?}, license} — the shape normalizeItem() has always
// produced, plus `source`.

const REQUIRED = ['getPicture', 'searchNearby', 'addCoverage', 'onPictureClick'];

const registry = new Map();

export function registerSource(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id) {
    throw new Error('registerSource: adapter.id (string) is required');
  }
  for (const m of REQUIRED) {
    if (typeof adapter[m] !== 'function') {
      throw new Error(`registerSource(${adapter.id}): ${m}() is required`);
    }
  }
  registry.set(adapter.id, adapter);
  return adapter;
}

export const getSourceById = (id) => registry.get(id) || null;
export const allSources = () => [...registry.values()];

// First registered source answers for bare picture ids (deep links, stored
// ids) — today that is Panoramax, and single-source behavior is unchanged.
export const defaultSource = () => registry.values().next().value || null;

// The adapter owning a normalized picture; falls back to the default so
// pictures from before the `source` field (old localStorage) keep working.
export const sourceOf = (pic) => getSourceById(pic?.source) || defaultSource();

// --- Registry-wide operations (what the app calls) ---------------------------

export function addCoverage(map) {
  for (const s of allSources()) s.addCoverage(map);
}

// handler(pic id, feature, adapter) — each source wires its own layers.
export function onPictureClick(map, handler) {
  for (const s of allSources()) s.onPictureClick(map, (id, f) => handler(id, f, s));
}

export function getPicture(id, sourceId) {
  const s = sourceId ? getSourceById(sourceId) : defaultSource();
  if (!s) throw new Error(`getPicture: no source${sourceId ? ` '${sourceId}'` : ' registered'}`);
  return s.getPicture(id);
}

// Nearby pictures across EVERY registered source (one failing source never
// hides the others' results). Sorted nearest-ish by the caller if it cares.
export async function searchNearby(lon, lat, radiusM, limit) {
  const batches = await Promise.all(
    allSources().map((s) => Promise.resolve(s.searchNearby(lon, lat, radiusM, limit)).catch(() => []))
  );
  return batches.flat();
}

// Capability-gated: sources without sequences yield an empty walk, not a crash.
export async function getSequence(pic, limit) {
  const s = sourceOf(pic);
  if (!s?.capabilities?.sequences || typeof s.getSequence !== 'function') return [];
  return s.getSequence(pic.sequenceId, limit);
}

// Capability-gated: null means "no HD refinement", the single-texture path.
export async function fetchTilesConfig(pic) {
  const s = sourceOf(pic);
  if (!s?.capabilities?.hdTiles || typeof s.fetchTilesConfig !== 'function') return null;
  return s.fetchTilesConfig(pic);
}

// Read-only sources never show editing UI (#112) — default is editable only
// when the owning adapter says so.
export const isEditable = (pic) => sourceOf(pic)?.capabilities?.editable === true;

// Show/hide one source's coverage layers (the HUD legend chips). Adapters
// declare their layer ids in `layers`; unknown sources/layers are no-ops.
export function setSourceVisible(map, sourceId, visible) {
  for (const layer of getSourceById(sourceId)?.layers || []) {
    if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

// Deep-link picture references (#112): a non-default source prefixes its id —
// "mapillary:854…" — so a shared/reloaded URL reopens through the owning
// adapter instead of 400ing on the default one. Default-source ids stay bare
// (every pre-#112 link keeps working).
export function encodePicRef(pic) {
  const d = defaultSource();
  return pic?.source && d && pic.source !== d.id ? `${pic.source}:${pic.id}` : String(pic?.id ?? '');
}

export function decodePicRef(ref) {
  const m = /^([a-z][a-z0-9_-]*):(.+)$/.exec(String(ref ?? ''));
  if (m && getSourceById(m[1])) return { id: m[2], sourceId: m[1] };
  return { id: String(ref ?? ''), sourceId: undefined };
}

// Map source ids of every registered source's coverage (convention: an
// adapter's map source is named after its adapter id). Street mode keeps ALL
// of these suspended (#27): far dots would bleed through the blend as fake
// clickable targets at the horizon — nearby 360°s are re-injected as real
// in-sphere ground dots instead, whatever their source.
export const coverageSources = () => allSources().map((s) => s.id);

// Hide/show every source's coverage layers at once. Street mode needs this on
// top of the tile budget: a GEOJSON-backed coverage (Commons) is not a tiled
// source, so suspendTileLayers never touches it — without this its dots would
// bleed through the blend inside the sphere exactly like #27's.
export function setAllCoverageVisible(map, visible) {
  for (const s of allSources()) setSourceVisible(map, s.id, visible);
}

// '#rrggbb' → [r, g, b] in 0..1 (the viewer's per-dot color format).
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Immersive floor-dot color for a picture — the SAME color language as the
// map layers (#112): the owning adapter declares `dotColors` per type
// ('equirectangular' / 'flat', hex). Fallback: the viewer's historical blue.
export function dotColor(pic) {
  const kind = pic?.type === 'equirectangular' ? 'equirectangular' : 'flat';
  return hexToRgb01(sourceOf(pic)?.dotColors?.[kind]) || [0.16, 0.4, 1.0];
}

// Test seam: wipe the registry (unit tests register fakes).
export const _resetSources = () => registry.clear();
