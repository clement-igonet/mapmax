// Street-view mode built on the vendored maplibre-gl-photosphere plugin.
// One Photosphere instance is reused for the whole session: enter() steps into
// a clicked picture, goTo() walks to an adjacent one (SPECIFICATIONS.md §2.2–2.5).
import { Photosphere } from './vendor/photosphere-plugin.js';
import { PHOTOSPHERE, MAP_MAX_PITCH, STREET_MAX_PITCH } from './config.js';
import { pictureToTarget } from './target.js';
import { suspendTileLayers, resumeTileLayers } from './tilebudget.js';
import { applyStreetBackdrop, removeStreetBackdrop } from './backdrop.js';
import { sunYawOffset } from './sunflip.js';

export { pictureToTarget };

let photosphere = null;
let svMap = null;
let current = null;
let pendingExit = false;
const listeners = [];

export const isStreetMode = () => !!photosphere && photosphere.mode !== 'outside';
export const currentPicture = () => current;
export function onPictureChanged(cb) {
  listeners.push(cb);
}
const emit = (pic) => {
  for (const cb of listeners) cb(pic);
};

// Sun-compass verdicts per sequence (#66): the mount is constant within a
// sequence, so one conclusive detection covers its shaded pictures too.
// Conclusive verdicts persist in localStorage; inconclusive ones retry later.
const yawVerdicts = new Map();
const YAW_KEY = (k) => `mapmax:yawflip:${k}`;
async function resolveYawOffset(pic) {
  if (pic.type !== 'equirectangular') return 0;
  const key = pic.sequenceId || pic.id;
  if (yawVerdicts.has(key)) return yawVerdicts.get(key);
  try {
    const stored = localStorage.getItem(YAW_KEY(key));
    if (stored != null) { yawVerdicts.set(key, +stored); return +stored; }
  } catch { /* private mode */ }
  const offset = await sunYawOffset(pic);
  // Only a positive flip detection is conclusive enough to cache persistently;
  // "no sun found" keeps retrying on later pictures of the sequence.
  if (offset === 180) {
    yawVerdicts.set(key, offset);
    try { localStorage.setItem(YAW_KEY(key), String(offset)); } catch { /* ignore */ }
  }
  return offset;
}

// Enter street view at `pic` (first click) or walk to it (already inside).
export async function enterStreetView(map, pic) {
  pic.yawOffset = await resolveYawOffset(pic);
  current = pic;
  svMap = map;

  if (!photosphere) {
    const entry = pictureToTarget(pic, true);
    photosphere = new Photosphere(map, {
      ...PHOTOSPHERE,
      lngLat: entry.lngLat,
      imageUrl: entry.imageUrl,
      exitView: { center: entry.lngLat, zoom: 17, pitch: 45, bearing: 0 },
      onEnter: () => {
        document.body.classList.add('street-mode');
        // Stop the pitch-90 tile-loading explosion: the sphere hides the map,
        // so suspend all tiled layers while inside (#11).
        suspendTileLayers(map);
        // Ground + sky backdrop so the vector-only view is never a raw-white
        // void (#37).
        applyStreetBackdrop(map);
        // Honor an exit requested during the enter animation (e.g. Esc mid-entry).
        if (pendingExit) {
          pendingExit = false;
          photosphere.exit();
        }
      },
      onExit: () => {
        document.body.classList.remove('street-mode');
        removeStreetBackdrop(map);
        try { map.setMaxPitch(MAP_MAX_PITCH); } catch { /* ignore */ }
        current = null;
        emit(null);
      },
      onMove: () => emit(current),
    });
  }

  // The plugin sits the camera at pitch ~90; give the transform the room.
  try { map.setMaxPitch(STREET_MAX_PITCH); } catch { /* ignore */ }

  if (photosphere.mode === 'inside') {
    photosphere.goTo(pictureToTarget(pic));
  } else if (photosphere.mode === 'outside') {
    photosphere.enter(pictureToTarget(pic, true));
  }
  emit(pic);
  return pic;
}

// Vector/photo blend (#6): alpha 1 = photo only (tiles suspended for #11),
// alpha < 1 reveals the vector layers behind the semi-transparent photo.
export function setBlend(alpha) {
  if (!photosphere || !svMap) return;
  photosphere.blend(alpha);
  if (alpha >= 0.99) suspendTileLayers(svMap);
  // Reveal OSM for mixing, but keep Panoramax tiles suspended so far POIs never
  // load in street mode — nearby ones show via the bounded GeoJSON (#27).
  else resumeTileLayers(svMap, ['panoramax']);
}

export function exitStreetView() {
  if (!photosphere) return;
  // Restore tiled layers before the exit animation so the map is there to
  // animate back onto (#11).
  resumeTileLayers(svMap);
  if (photosphere.mode === 'inside') photosphere.exit();
  else if (photosphere.mode === 'entering') pendingExit = true; // exit once entered
}

// Test/introspection helper.
export const _photosphere = () => photosphere;
