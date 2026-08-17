// Pose helpers (#98) — pure logic, no DOM/WebGL/network, unit-tested offline.
//
// A panorama's pose is pitch / roll / yaw:
//   pitch  −90..90   horizon = 0, top = +90 (camera tilted up at capture)
//   roll   −90..90   flat = 0, right-arm down = +90
//   yaw    0..360    offset of the image centre from the GPS-derived direction
// MapMax is READ-oriented: corrections apply live in the shader and persist in
// localStorage only. Server write-back deliberately lives outside the app, in
// the maplibre-gl-panoramax package.

// Upstream split (#110, layering decision of 2026-08-11): the RENDERING maths
// (pose matrix, direction transform) ship with maplibre-gl-photosphere 0.4.0;
// the EDITING algebra (gesture composition, Euler extraction) lives in
// maplibre-gl-panoramax next to the write-back API. Both vendored verbatim
// (see src/vendor/*/VENDOR.md) and re-exported here so app modules and tests
// keep a single import site. This file keeps what is MapMax-specific:
// PATCH builders, home-instance resolution, exif pose, storage keys,
// geo offsets.
export {
  normalizeYaw,
  panoPoseMatrix,
  poseTransform,
} from './vendor/photosphere/pose.js';
export {
  axisRotationMatrix,
  composePoseGesture,
  mat3Multiply,
  poseFromMatrix,
} from './vendor/panoramax/gesture.js';
import { normalizeYaw } from './vendor/photosphere/pose.js';

const clampDeg = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// The API base of the item's HOME instance. Items are read via the federated
// meta-catalog (api.panoramax.xyz) whose self links stay on the catalog and
// which refuses PATCH (405) — the `via` link carries the owning instance
// (e.g. https://panoramax.openstreetmap.fr), where the write-back must go.
export function apiBaseFromSelfHref(href) {
  const m = typeof href === 'string' ? href.match(/^(.*?)\/collections\//) : null;
  return m ? m[1] : null;
}

export function homeApiBase(links, selfHref) {
  const via = (links || []).find((l) => l && l.rel === 'via' && typeof l.href === 'string');
  if (via) return `${via.href.replace(/\/+$/, '')}/api`;
  return apiBaseFromSelfHref(selfHref);
}

// Capture pose from a STAC item's exif, when the camera wrote one (GoPro Max
// & co. write PosePitchDegrees = 0.0 regardless — hence the manual corrector).
export function readPoseFromExif(exif) {
  const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    pitch: num(exif?.['Xmp.GPano.PosePitchDegrees']),
    roll: num(exif?.['Xmp.GPano.PoseRollDegrees']),
  };
}

// Manual rotation nudges (#144): a fixed step per click — fine enough to
// settle a horizon by eye, coarse enough to get there in a few clicks — with
// a bigger step on ⇧, mirroring the translation pad (#107). Pitch and roll are
// clamped to the API domains (±90°); yaw wraps instead.
export const ROT_STEP_DEG = 0.5;
export const ROT_STEP_SHIFT_DEG = 2;

export function nudgeTilt(currentDeg, direction, shiftKey = false) {
  const step = (shiftKey ? ROT_STEP_SHIFT_DEG : ROT_STEP_DEG) * Math.sign(direction || 0);
  return clampDeg((currentDeg || 0) + step, -90, 90);
}

// localStorage key for the per-sequence pose fallback (anonymous users, #98).
export const POSE_STORE_KEY = (seqOrPicId) => `mapmax:pose:${seqOrPicId}`;

// --- Position correction (#107) ---------------------------------------------
// GPS noise is a TRANSLATION error; the override is stored per PICTURE (unlike
// pose, which is per sequence) as metres {e, n, u} east/north/up.

export const POSITION_STORE_KEY = (picId) => `mapmax:pos:${picId}`;

// Apply an east/north offset in metres to a lon/lat (equirectangular local
// approximation — exact enough for the few metres GPS correction needs).
export function offsetLngLat(lon, lat, eastM, northM) {
  const dLat = northM / 111320;
  const dLon = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}
