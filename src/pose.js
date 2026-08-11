// Pose corrector (#98) — pure logic, no DOM/WebGL/network, unit-tested offline.
//
// A panorama's pose is pitch / roll / yaw, matching the Panoramax PATCH API
// (`PATCH /api/collections/:cid/items/:iid`, v2.14.0):
//   pitch  −90..90   horizon = 0, top = +90 (camera tilted up at capture)
//   roll   −90..90   flat = 0, right-arm down = +90
//   yaw    0..360    offset of the image centre from the GPS-derived direction
//                    (front = 0, right = 90) — same meaning as our yawOffset (#69)
// Corrections are applied live in the photosphere shader via panoPoseMatrix()
// and written back with buildPosePatch()/posePatchRequest() when a Panoramax
// token is present (localStorage fallback otherwise — streetview.js).

// The viewer maths (pose matrix, gesture composition, Euler extraction) live
// in the photosphere plugin since its 0.4.0 (#110) — re-exported here so app
// modules and tests keep a single import site. This file keeps what is
// PANORAMAX-specific: PATCH builders, home-instance resolution, exif pose,
// storage keys, geo offsets.
export {
  axisRotationMatrix,
  composePoseGesture,
  mat3Multiply,
  normalizeYaw,
  panoPoseMatrix,
  poseFromMatrix,
  poseTransform,
} from './vendor/photosphere/pose.js';
import { normalizeYaw } from './vendor/photosphere/pose.js';

const clampDeg = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Clamp a pose to the API domains; missing/invalid components → undefined.
export function clampPose(pose = {}) {
  return {
    pitch: isNum(pose.pitch) ? clampDeg(pose.pitch, -90, 90) : undefined,
    roll: isNum(pose.roll) ? clampDeg(pose.roll, -90, 90) : undefined,
    yaw: isNum(pose.yaw) ? normalizeYaw(pose.yaw) : undefined,
  };
}

// PATCH body: only the components explicitly set, clamped to the API domains.
// null when there is nothing to send (so callers can skip the request).
export function buildPosePatch(pose) {
  const p = clampPose(pose);
  const body = {};
  if (p.pitch !== undefined) body.pitch = p.pitch;
  if (p.roll !== undefined) body.roll = p.roll;
  if (p.yaw !== undefined) body.yaw = p.yaw;
  return Object.keys(body).length ? body : null;
}

// Full fetch() arguments for the write-back — pure so the whole request is
// unit-tested without network. null when there is nothing to send.
// The browser calls Panoramax directly with the user's token (front-end only, R3).
// `position` (optional, #107): corrected ABSOLUTE {latitude, longitude} —
// PATCHable since v2.8.0. Altitude has no API field and never leaves the app.
export function posePatchRequest(apiBase, collectionId, itemId, pose, token, position) {
  if (!token) throw new Error('posePatchRequest: a Panoramax token is required');
  if (!collectionId || !itemId) throw new Error('posePatchRequest: collectionId and itemId are required');
  const body = buildPosePatch(pose) || {};
  if (Number.isFinite(position?.latitude) && Number.isFinite(position?.longitude)) {
    body.latitude = position.latitude;
    body.longitude = position.longitude;
  }
  if (!Object.keys(body).length) return null;
  return {
    url: `${apiBase}/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
    init: {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  };
}

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
