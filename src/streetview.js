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
import { POSE_STORE_KEY, POSITION_STORE_KEY, composePoseGesture, normalizeYaw, offsetLngLat, posePatchRequest } from './pose.js';

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
  photosphere.setPanoPose({ yaw: ((current.heading || 0) + next) % 360 });
  return next;
}

// --- Pose corrector (#98) ---------------------------------------------------
// pitch/roll capture-pose per sequence: localStorage override wins, then the
// camera-written exif pose (GoPro & co. write 0.0 regardless — hence the UI).
function resolvePitchRoll(pic) {
  const stored = lsGet(POSE_STORE_KEY(pic.sequenceId || pic.id));
  if (stored != null) {
    try {
      const p = JSON.parse(stored);
      return { pitch: +p.pitch || 0, roll: +p.roll || 0 };
    } catch { /* fall through to exif */ }
  }
  return { pitch: pic.exifPose?.pitch || 0, roll: pic.exifPose?.roll || 0 };
}

// The pose as shown/edited in the UI: pitch/roll (capture tilt to undo) and
// yaw = offset of the image centre from the GPS direction (the flip's unit).
export function getCurrentPose() {
  if (!current) return null;
  return {
    pitch: current.posePitch || 0,
    roll: current.poseRoll || 0,
    yaw: normalizeYaw(current.yawOffset || 0),
  };
}

// Debounced pose persistence (#98): a slider drag fires dozens of input events
// per second — a synchronous localStorage write on each contributes jank while
// the canvas repaints. Apply live, persist once the drag settles.
let poseSaveTimer = 0;
let poseSavePending = null; // { key, pose, yaw } — yaw only once touched
function flushPoseSave() {
  clearTimeout(poseSaveTimer);
  if (!poseSavePending) return;
  const p = poseSavePending;
  poseSavePending = null;
  lsSet(POSE_STORE_KEY(p.key), p.pose);
  if (p.yaw != null) lsSet(OVERRIDE_KEY(p.key), p.yaw);
}

// Live-apply + persist locally (anonymous fallback — write-back is separate).
// Only the components provided change.
export function setCurrentPose({ pitch, roll, yaw } = {}) {
  if (!current || !photosphere) return null;
  const key = current.sequenceId || current.id;
  if (typeof pitch === 'number' && Number.isFinite(pitch)) current.posePitch = pitch;
  if (typeof roll === 'number' && Number.isFinite(roll)) current.poseRoll = roll;
  const yawTouched = typeof yaw === 'number' && Number.isFinite(yaw);
  if (yawTouched) current.yawOffset = normalizeYaw(yaw);
  poseSavePending = {
    key,
    pose: JSON.stringify({ pitch: current.posePitch || 0, roll: current.poseRoll || 0 }),
    // Carry an earlier-touched yaw across the merge so a later pitch/roll tweak
    // doesn't drop it; never write the yaw override unless the user set it.
    yaw: yawTouched ? String(current.yawOffset)
      : (poseSavePending && poseSavePending.key === key ? poseSavePending.yaw : null),
  };
  clearTimeout(poseSaveTimer);
  poseSaveTimer = setTimeout(flushPoseSave, 250);
  photosphere.setPanoPose({
    yaw: normalizeYaw((current.heading || 0) + (current.yawOffset || 0)),
    pitch: current.posePitch || 0,
    roll: current.poseRoll || 0,
  });
  return getCurrentPose();
}

// --- Position correction (#107) ---------------------------------------------
// GPS noise is a translation: per-PICTURE metre offsets {e, n, u} (east/north/
// up), applied by re-anchoring the photosphere. e/n are PATCHable as absolute
// lat/lon; u (altitude) has no API field and stays local.
const clampM = (v, lim) => Math.max(-lim, Math.min(lim, v || 0));

function resolvePositionOffset(pic) {
  const stored = lsGet(POSITION_STORE_KEY(pic.id));
  if (stored != null) {
    try {
      const p = JSON.parse(stored);
      return { e: +p.e || 0, n: +p.n || 0, u: +p.u || 0 };
    } catch { /* corrupted — fall through */ }
  }
  return { e: 0, n: 0, u: 0 };
}

export function getCurrentPositionOffset() {
  if (!current) return null;
  return { ...(current.posOffset || { e: 0, n: 0, u: 0 }) };
}

function applyPositionOverride() {
  if (!current || !photosphere) return;
  const o = current.posOffset || { e: 0, n: 0, u: 0 };
  photosphere.setAnchor(
    offsetLngLat(current.lon, current.lat, o.e, o.n),
    PHOTOSPHERE.eyeHeight + o.u
  );
}

let posSaveTimer = 0;
export function nudgeCurrentPosition({ eastM = 0, northM = 0, upM = 0 } = {}) {
  if (!current || !photosphere) return null;
  const o = current.posOffset || (current.posOffset = { e: 0, n: 0, u: 0 });
  // Guard rails: GPS corrections are metres, not blocks; eye stays plausible.
  o.e = clampM(o.e + eastM, 50);
  o.n = clampM(o.n + northM, 50);
  o.u = Math.max(-3, Math.min(6, (o.u || 0) + upM));
  applyPositionOverride();
  const key = POSITION_STORE_KEY(current.id);
  const json = JSON.stringify(o);
  clearTimeout(posSaveTimer);
  posSaveTimer = setTimeout(() => lsSet(key, json), 250);
  return getCurrentPositionOffset();
}

export function resetCurrentPosition() {
  if (!current) return null;
  current.posOffset = { e: 0, n: 0, u: 0 };
  applyPositionOverride();
  lsSet(POSITION_STORE_KEY(current.id), JSON.stringify(current.posOffset));
  return getCurrentPositionOffset();
}

// --- Pose edit mode (#106) --------------------------------------------------
// While on, dragging the canvas rotates the PHOTO (view-space composition on
// the pose) instead of the camera; the ring control feeds aboutForward.
let poseEditOn = false;
export const isPoseEditMode = () => poseEditOn;

// Apply a view-space gesture (degrees) to the current pano's pose and return
// the resulting {pitch, roll, yaw(offset)} — see composePoseGesture for axes.
export function applyPoseGesture(deltas) {
  if (!current || !photosphere) return null;
  const total = {
    yaw: normalizeYaw((current.heading || 0) + (current.yawOffset || 0)),
    pitch: current.posePitch || 0,
    roll: current.poseRoll || 0,
  };
  const camera = { yawDeg: photosphere.yaw, pitchDeg: photosphere.pitch };
  const next = composePoseGesture(total, camera, deltas);
  return setCurrentPose({
    pitch: next.pitch,
    roll: next.roll,
    yaw: normalizeYaw(next.yaw - (current.heading || 0)),
  });
}

// Toggle edit mode. `onChange` (optional) fires after every drag-applied
// gesture so the UI can mirror the values (sliders, ring handle).
export function setPoseEditMode(on, onChange) {
  if (!photosphere || !current) on = false;
  poseEditOn = !!on;
  photosphere?.setPoseEditDrag(poseEditOn
    ? (dxDeg, dyDeg, info) => {
      if (info?.shiftKey) {
        // ⇧-drag grabs the GROUND (#107): the vector world follows the cursor,
        // so the anchor moves opposite the dragged ground delta.
        const gPrev = photosphere.groundPointAt(info.prevX, info.prevY);
        const gNow = photosphere.groundPointAt(info.x, info.y);
        if (gPrev && gNow) {
          nudgeCurrentPosition({ eastM: -(gNow[0] - gPrev[0]), northM: -(gNow[1] - gPrev[1]) });
        }
      } else {
        // Grab-the-photo feel: content follows the cursor (signs derive from
        // the composePoseGesture convention pinned by the unit tests).
        applyPoseGesture({ aboutUp: -dxDeg, aboutRight: -dyDeg });
      }
      if (onChange) onChange();
    }
    : null);
  return poseEditOn;
}

// Write the displayed pose back to the picture's HOME Panoramax instance
// (PATCH, v2.14.0) with the user's token — fixed at the source, for every
// viewer. The browser calls the API directly (front-end only, R3).
export async function savePoseToPanoramax(token) {
  if (!current) return { ok: false, error: 'not in a panorama' };
  if (!current.homeApi) return { ok: false, error: 'unknown home instance for this picture' };
  // A horizontal position correction rides in the same PATCH as absolute
  // lat/lon (#107); altitude has no API field — reported so the UI can say so.
  const o = current.posOffset;
  let position;
  if (o && (o.e || o.n)) {
    const [lon, lat] = offsetLngLat(current.lon, current.lat, o.e, o.n);
    position = { latitude: lat, longitude: lon };
  }
  const req = posePatchRequest(current.homeApi, current.sequenceId, current.id, getCurrentPose(), token, position);
  if (!req) return { ok: false, error: 'nothing to save' };
  try {
    const res = await fetch(req.url, req.init);
    if (!res.ok) return { ok: false, status: res.status, error: `Panoramax answered ${res.status}` };
    return { ok: true, status: res.status, altitudeLocalOnly: !!(o && o.u) };
  } catch (err) {
    return { ok: false, error: err?.message || 'network error (CORS?)' };
  }
}

// Enter street view at `pic` (first click) or walk to it (already inside).
export async function enterStreetView(map, pic) {
  flushPoseSave(); // a still-pending pose write must land before we read the store (#98)
  pic.yawOffset = await resolveYawOffset(pic);
  const pr = resolvePitchRoll(pic); // #98
  pic.posePitch = pr.pitch;
  pic.poseRoll = pr.roll;
  pic.posOffset = resolvePositionOffset(pic); // #107
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
        // Re-anchor onto the corrected position, if this picture has one (#107).
        applyPositionOverride();
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
      onMove: () => {
        // A walk lands on the target's ORIGINAL anchor — re-apply the new
        // picture's position correction before anyone reads the state (#107).
        applyPositionOverride();
        emit(current);
      },
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
  flushPoseSave(); // don't lose a tweak made just before Esc (#98)
  if (!photosphere) return;
  // Restore tiled layers before the exit animation so the map is there to
  // animate back onto (#11).
  resumeTileLayers(svMap);
  if (photosphere.mode === 'inside') photosphere.exit();
  else if (photosphere.mode === 'entering') pendingExit = true; // exit once entered
}

// Test/introspection helper.
export const _photosphere = () => photosphere;
