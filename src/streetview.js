// Street-view mode built on the vendored maplibre-gl-photosphere plugin.
// One Photosphere instance is reused for the whole session: enter() steps into
// a clicked picture, goTo() walks to an adjacent one (SPECIFICATIONS.md §2.2–2.5).
import { Photosphere } from './vendor/photosphere-plugin.js';
import { PHOTOSPHERE, MAP_MAX_PITCH, STREET_MAX_PITCH, STREET_DEFAULT_BLEND } from './config.js';
import { pictureToTarget } from './target.js';
import { suspendTileLayers, resumeTileLayers } from './tilebudget.js';
import { applyStreetBackdrop, removeStreetBackdrop } from './backdrop.js';
import { consensusVerdict, sunYawVerdict } from './sunflip.js';
import { getSequence } from './panoramax.js';

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

// Sun-compass verdicts per sequence (#66/#69): the mount is constant within a
// sequence, so one conclusive detection covers its shaded pictures too. When the
// entered picture is inconclusive (evening ride, narrow alley), scan a few other
// pictures of the sequence — the ride usually crosses sunlight somewhere. A
// manual override (the flip button, #69) always wins over the auto verdict.
const yawVerdicts = new Map();
// v2 (#71): key bumped so wrong single-vote verdicts persisted by the previous
// build are discarded client-side.
const YAW_KEY = (k) => `mapmax:yawflip2:${k}`;
const OVERRIDE_KEY = (k) => `mapmax:yawoverride:${k}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

async function resolveYawOffset(pic) {
  if (pic.type !== 'equirectangular') return 0;
  const key = pic.sequenceId || pic.id;
  const override = lsGet(OVERRIDE_KEY(key));
  if (override != null) return +override;
  if (yawVerdicts.has(key)) return yawVerdicts.get(key);
  const stored = lsGet(YAW_KEY(key));
  if (stored != null) { yawVerdicts.set(key, +stored); return +stored; }

  // Consensus scan (#69/#71): the sun is fixed in the world, clouds are random
  // per picture — so a real mount direction produces consistent votes across the
  // ride. Vote with the entered picture plus up to ~10 spread over the sequence;
  // conclude only on agreement (≥2 same, ≤1 dissent).
  const votes = [await sunYawVerdict(pic)];
  let verdict = consensusVerdict(votes);
  if (verdict == null && pic.sequenceId) {
    try {
      const seq = (await getSequence(pic.sequenceId, 120)).filter((p) => p.id !== pic.id && p.type === 'equirectangular');
      const step = Math.max(1, Math.floor(seq.length / 10));
      for (let i = 0; i < seq.length && verdict == null; i += step) {
        votes.push(await sunYawVerdict(seq[i]));
        verdict = consensusVerdict(votes);
      }
    } catch { /* offline etc. — stay inconclusive */ }
  }
  if (verdict != null) {
    yawVerdicts.set(key, verdict);
    lsSet(YAW_KEY(key), String(verdict));
    return verdict;
  }
  return 0; // no consensus — default to metadata orientation, retry later
}

// Manual 180° flip for the current sequence (#69): overrides the auto verdict,
// persists, and re-renders the current pano immediately.
export function flipCurrentPano() {
  if (!current || !photosphere) return null;
  const key = current.sequenceId || current.id;
  const next = ((current.yawOffset || 0) + 180) % 360;
  lsSet(OVERRIDE_KEY(key), String(next));
  current.yawOffset = next;
  photosphere._panoYawDeg = ((current.heading || 0) + next) % 360;
  svMap?.triggerRepaint();
  return next;
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
        // Start mixed, not photo-only (#101): applied here (after the suspend
        // above) so the default 50/50 actually reveals the OSM layers.
        setBlend(currentBlend);
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
        // Next entry starts at the default mix again — matches the slider
        // reset in main.js leaveStreetUI (#101).
        currentBlend = STREET_DEFAULT_BLEND;
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
// Defaults to 50/50 on entry (#101); onEnter re-applies the remembered value.
let currentBlend = STREET_DEFAULT_BLEND;
export function setBlend(alpha) {
  currentBlend = alpha;
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
