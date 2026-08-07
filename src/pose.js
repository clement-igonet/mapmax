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

const clampDeg = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Normalize any yaw to the API's [0, 360) domain (−180 → 180, 540 → 180).
export const normalizeYaw = (deg) => ((deg % 360) + 360) % 360;

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
export function posePatchRequest(apiBase, collectionId, itemId, pose, token) {
  if (!token) throw new Error('posePatchRequest: a Panoramax token is required');
  if (!collectionId || !itemId) throw new Error('posePatchRequest: collectionId and itemId are required');
  const body = buildPosePatch(pose);
  if (!body) return null;
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

// World → camera-frame rotation for the photosphere shader.
//
// Axes (matching the plugin, src/vendor/photosphere-plugin.js): world x = east,
// y = north, z = up; azimuth is measured from +y toward +x. The camera basis is
// built yaw → pitch → roll:
//   forward f = [sinY·cosP, cosY·cosP, sinP]      (image centre direction)
//   right   r = [cosY, −sinY, 0] rolled about f   (+roll = right-arm down)
//   up      u = r × f rolled about f
// Returns the COLUMN-MAJOR 9-array for gl.uniformMatrix3fv of the matrix M with
// rows r/f/u, so the shader's `M * dir` yields camera-frame coords and
//   theta = atan(nc.x, nc.y), phi = asin(nc.z)
// generalizes the previous yaw-only `atan(n.x, n.y) − panoYaw`.
export function panoPoseMatrix(yawDeg, pitchDeg = 0, rollDeg = 0) {
  const d2r = Math.PI / 180;
  const Y = (yawDeg || 0) * d2r, P = (pitchDeg || 0) * d2r, R = (rollDeg || 0) * d2r;
  const sY = Math.sin(Y), cY = Math.cos(Y);
  const sP = Math.sin(P), cP = Math.cos(P);
  const sR = Math.sin(R), cR = Math.cos(R);

  const f = [sY * cP, cY * cP, sP];
  // Analytic right/up before roll (stays valid at |pitch| = 90 where
  // cross(f, worldUp) degenerates).
  const r0 = [cY, -sY, 0];
  const u0 = [-sY * sP, -cY * sP, cP];
  // Rodrigues about f: r' = r0·cosR − u0·sinR, u' = u0·cosR + r0·sinR.
  const r = [r0[0] * cR - u0[0] * sR, r0[1] * cR - u0[1] * sR, r0[2] * cR - u0[2] * sR];
  const u = [u0[0] * cR + r0[0] * sR, u0[1] * cR + r0[1] * sR, u0[2] * cR + r0[2] * sR];

  // Column-major of M(rows r, f, u).
  return [r[0], f[0], u[0], r[1], f[1], u[1], r[2], f[2], u[2]];
}

// Apply the matrix to a world direction (test/reference twin of the GLSL path).
export function poseTransform(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

// --- Edit-mode gesture maths (#106) ----------------------------------------
// A drag/ring gesture is a small rotation about a VIEW-space axis (world up,
// camera right, camera forward). It composes onto the pose as M' = M · G⁻¹
// (G rotates the photo content in world space; sampling then asks where a view
// ray landed before the rotation), and the result is re-extracted as
// yaw→pitch→roll so storage, sliders and the PATCH API stay in the #98 model.

// Column-major 3×3 product a·b (same layout as panoPoseMatrix).
export function mat3Multiply(a, b) {
  const c = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      c[j * 3 + i] = a[0 * 3 + i] * b[j * 3 + 0] + a[1 * 3 + i] * b[j * 3 + 1] + a[2 * 3 + i] * b[j * 3 + 2];
    }
  }
  return c;
}

// Rodrigues rotation about a (unit) world axis, column-major.
export function axisRotationMatrix(axis, deg) {
  const [x, y, z] = axis;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C, y * x * C + z * s, z * x * C - y * s,
    x * y * C - z * s, c + y * y * C, z * y * C + x * s,
    x * z * C + y * s, y * z * C - x * s, c + z * z * C,
  ];
}

// Inverse of panoPoseMatrix: extract {yaw, pitch, roll} (degrees, yaw in
// [0,360)) from a pose matrix. At |pitch| = 90 yaw is degenerate (gimbal) —
// atan2(0,0) = 0 is returned, which panoPoseMatrix maps back to the same
// matrix, so the roundtrip stays exact.
export function poseFromMatrix(m) {
  const r = [m[0], m[3], m[6]];
  const f = [m[1], m[4], m[7]];
  const P = Math.asin(Math.max(-1, Math.min(1, f[2])));
  const Y = Math.atan2(f[0], f[1]);
  const sY = Math.sin(Y), cY = Math.cos(Y), sP = Math.sin(P), cP = Math.cos(P);
  const r0 = [cY, -sY, 0];
  const u0 = [-sY * sP, -cY * sP, cP];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const R = Math.atan2(-dot(r, u0), dot(r, r0));
  const r2d = 180 / Math.PI;
  return { yaw: normalizeYaw(Y * r2d), pitch: P * r2d, roll: R * r2d };
}

// Compose a view-space gesture onto a pose. `camera` = {yawDeg, pitchDeg} of
// the CURRENT look direction (the axes the user reasons in); deltas in degrees:
//   aboutUp      — horizontal drag: photo turns about the world vertical axis
//   aboutRight   — vertical drag: photo tilts about the view's horizontal
//                  lateral axis (stays horizontal whatever the look pitch)
//   aboutForward — ring control: photo rolls about the viewing axis
export function composePoseGesture(pose, camera, { aboutUp = 0, aboutRight = 0, aboutForward = 0 } = {}) {
  const d2r = Math.PI / 180;
  const cy = (camera?.yawDeg || 0) * d2r, cp = (camera?.pitchDeg || 0) * d2r;
  let m = panoPoseMatrix(pose.yaw || 0, pose.pitch || 0, pose.roll || 0);
  const apply = (axis, deg) => {
    if (deg) m = mat3Multiply(m, axisRotationMatrix(axis, -deg));
  };
  apply([0, 0, 1], aboutUp);
  apply([Math.cos(cy), -Math.sin(cy), 0], aboutRight);
  apply([Math.cos(cp) * Math.sin(cy), Math.cos(cp) * Math.cos(cy), Math.sin(cp)], aboutForward);
  return poseFromMatrix(m);
}

// localStorage key for the per-sequence pose fallback (anonymous users, #98).
export const POSE_STORE_KEY = (seqOrPicId) => `mapmax:pose:${seqOrPicId}`;
