// Street-view mode: camera at human eye height at the picture position,
// Google-Street-View-like look-around controls, entry/exit lifecycle.
import {
  addPhotosphereLayer,
  hidePhotosphere,
  nudgeYawOffset,
  showPicture,
  transitionToPicture,
} from './photosphere.js';
import { clamp, zoomForEyeHeight } from './geo.js';
import { easeInOutCubic, transitionPlan } from './transition.js';

const EYE_HEIGHT_M = 1.7; // human sight (SPECIFICATIONS.md §2.2)
const STREET_PITCH = 85;
const MIN_PITCH_STREET = 35;
const FOV_MIN = 22;
const FOV_MAX = 95;
const LOOK_SPEED = 0.22; // degrees per pixel dragged

const state = {
  active: false,
  pic: null,
  maxPitch: STREET_PITCH,
  savedView: null,
  listeners: [], // notified with the picture on move, null on exit
};

export const isStreetMode = () => state.active;
export const currentPicture = () => state.pic;
export function onPictureChanged(cb) {
  state.listeners.push(cb);
}
const emitPictureChanged = (pic) => {
  for (const cb of state.listeners) cb(pic);
};

function setHandlers(map, enabled) {
  const handlers = [
    map.dragPan, map.dragRotate, map.scrollZoom, map.boxZoom,
    map.doubleClickZoom, map.keyboard, map.touchZoomRotate, map.touchPitch,
  ];
  for (const h of handlers) (enabled ? h.enable : h.disable).call(h);
}

export async function enterStreetView(map, pic) {
  addPhotosphereLayer(map);
  if (!state.active) {
    state.savedView = {
      center: map.getCenter(), zoom: map.getZoom(),
      pitch: map.getPitch(), bearing: map.getBearing(),
      maxPitch: map.getMaxPitch(),
    };
    // Let the user look slightly above the horizon where the engine allows it.
    try {
      map.setMaxPitch(105);
      state.maxPitch = 105;
    } catch {
      state.maxPitch = STREET_PITCH;
    }
    setHandlers(map, false);
    installLookControls(map);
    state.active = true;
    document.body.classList.add('street-mode');
  }
  const from = state.pic;
  state.pic = pic;
  const zoom = zoomForEyeHeight(map.transform.height, map.transform.fov, pic.lat, STREET_PITCH, EYE_HEIGHT_M);

  if (from && from.id !== pic.id) {
    // Continuous movement to a nearby picture (SPECIFICATIONS.md §2.4): the
    // map camera glides while the spheres cross-fade; the view direction is
    // kept (Street-View behavior), only the position changes.
    const plan = transitionPlan(from, pic);
    map.easeTo({
      center: [pic.lon, pic.lat],
      zoom,
      duration: plan.duration,
      easing: easeInOutCubic,
    });
    await transitionToPicture(pic, plan);
  } else {
    map.jumpTo({
      center: [pic.lon, pic.lat],
      zoom,
      pitch: STREET_PITCH,
      bearing: pic.heading,
    });
    await showPicture(pic);
  }
  emitPictureChanged(pic);
  return pic;
}

export function exitStreetView(map) {
  if (!state.active) return;
  state.active = false;
  document.body.classList.remove('street-mode');
  removeLookControls(map);
  hidePhotosphere();
  emitPictureChanged(null);
  setHandlers(map, true);
  const v = state.savedView;
  try {
    map.setMaxPitch(v?.maxPitch ?? STREET_PITCH);
  } catch {}
  map.easeTo({
    center: state.pic ? [state.pic.lon, state.pic.lat] : v.center,
    zoom: Math.min(v?.zoom ?? 17, 18),
    pitch: v?.pitch ?? 55,
    bearing: map.getBearing(),
    duration: 800,
  });
  state.pic = null;
}

// --- Look-around controls ---------------------------------------------------

let listeners = null;

function installLookControls(map) {
  const canvas = map.getCanvas();
  let dragging = false;
  let last = null;

  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    // Drag the world: pull left → look right; pull down → look up.
    map.jumpTo({
      bearing: map.getBearing() - dx * LOOK_SPEED,
      pitch: clamp(map.getPitch() + dy * LOOK_SPEED, MIN_PITCH_STREET, state.maxPitch),
    });
  };
  const up = (e) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  const wheel = (e) => {
    e.preventDefault();
    setFov(map, getFov(map) + (e.deltaY > 0 ? 4 : -4));
  };
  const key = (e) => {
    if (e.key === 'Escape') exitStreetView(map);
    else if (e.key === '[') nudgeYawOffset(-5);
    else if (e.key === ']') nudgeYawOffset(5);
  };

  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', key);
  listeners = { canvas, down, move, up, wheel, key };
}

function removeLookControls(map) {
  if (!listeners) return;
  const { canvas, down, move, up, wheel, key } = listeners;
  canvas.removeEventListener('pointerdown', down);
  window.removeEventListener('pointermove', move);
  window.removeEventListener('pointerup', up);
  canvas.removeEventListener('wheel', wheel);
  window.removeEventListener('keydown', key);
  listeners = null;
}

// FOV zoom: photo and vector layers share the map's vertical field of view
// where the engine supports it (MapLibre v5+), so zooming keeps them aligned.
export function getFov(map) {
  return map.transform.fov;
}

export function setFov(map, fov) {
  const v = clamp(fov, FOV_MIN, FOV_MAX);
  if (typeof map.setVerticalFieldOfView === 'function') {
    map.setVerticalFieldOfView(v);
  } else {
    map.transform.fov = v;
    map.triggerRepaint();
  }
}
