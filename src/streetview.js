// Street-view mode built on the vendored maplibre-gl-photosphere plugin.
// One Photosphere instance is reused for the whole session: enter() steps into
// a clicked picture, goTo() walks to an adjacent one (SPECIFICATIONS.md §2.2–2.5).
import { Photosphere } from './vendor/photosphere-plugin.js';
import { PHOTOSPHERE, MAP_MAX_PITCH, STREET_MAX_PITCH } from './config.js';
import { pictureToTarget } from './target.js';
import { suspendTileLayers, resumeTileLayers } from './tilebudget.js';

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

// Enter street view at `pic` (first click) or walk to it (already inside).
export function enterStreetView(map, pic) {
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
        // Honor an exit requested during the enter animation (e.g. Esc mid-entry).
        if (pendingExit) {
          pendingExit = false;
          photosphere.exit();
        }
      },
      onExit: () => {
        document.body.classList.remove('street-mode');
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
