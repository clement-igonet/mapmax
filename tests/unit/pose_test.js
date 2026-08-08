// Unit tests for the photosphere pose corrector (#98): PATCH-body builder,
// request builder, and the world→camera pose matrix the shader consumes.
import { assertEquals, assertThrows, assertAlmostEquals } from 'jsr:@std/assert@1';
import {
  apiBaseFromSelfHref,
  axisRotationMatrix,
  buildPosePatch,
  clampPose,
  composePoseGesture,
  homeApiBase,
  mat3Multiply,
  normalizeYaw,
  offsetLngLat,
  panoPoseMatrix,
  poseFromMatrix,
  posePatchRequest,
  poseTransform,
  readPoseFromExif,
  POSE_STORE_KEY,
  POSITION_STORE_KEY,
} from '../../src/pose.js';

// --- PATCH body -------------------------------------------------------------

Deno.test('buildPosePatch: only the components explicitly set', () => {
  assertEquals(buildPosePatch({ pitch: 5.5 }), { pitch: 5.5 });
  assertEquals(buildPosePatch({ pitch: -3, roll: 2, yaw: 180 }), { pitch: -3, roll: 2, yaw: 180 });
  assertEquals(buildPosePatch({ roll: 0 }), { roll: 0 }); // 0 is a real correction
});

Deno.test('buildPosePatch: nothing to send → null', () => {
  assertEquals(buildPosePatch({}), null);
  assertEquals(buildPosePatch({ pitch: NaN, yaw: 'x' }), null);
  assertEquals(buildPosePatch(undefined), null);
});

Deno.test('clampPose: API domains — pitch/roll ±90, yaw [0,360)', () => {
  assertEquals(clampPose({ pitch: 120, roll: -95 }), { pitch: 90, roll: -90, yaw: undefined });
  assertEquals(clampPose({ yaw: -90 }).yaw, 270); // −90 → 270, the API domain
  assertEquals(clampPose({ yaw: 540 }).yaw, 180);
});

Deno.test('normalizeYaw: [0,360) for any input', () => {
  assertEquals(normalizeYaw(0), 0);
  assertEquals(normalizeYaw(-180), 180);
  assertEquals(normalizeYaw(360), 0);
  assertEquals(normalizeYaw(725), 5);
});

// --- Request builder --------------------------------------------------------

Deno.test('posePatchRequest: URL, method, bearer auth and JSON body', () => {
  const req = posePatchRequest('https://api.panoramax.xyz/api', 'seq-1', 'pic-1', { pitch: -4, yaw: 180 }, 'tok123');
  assertEquals(req.url, 'https://api.panoramax.xyz/api/collections/seq-1/items/pic-1');
  assertEquals(req.init.method, 'PATCH');
  assertEquals(req.init.headers.Authorization, 'Bearer tok123');
  assertEquals(req.init.headers['Content-Type'], 'application/json');
  assertEquals(JSON.parse(req.init.body), { pitch: -4, yaw: 180 });
});

Deno.test('posePatchRequest: ids are URL-encoded', () => {
  const req = posePatchRequest('https://x/api', 'a/b', 'c d', { roll: 1 }, 't');
  assertEquals(req.url, 'https://x/api/collections/a%2Fb/items/c%20d');
});

Deno.test('posePatchRequest: token required; empty pose → null (skip request)', () => {
  assertThrows(() => posePatchRequest('https://x/api', 'c', 'i', { pitch: 1 }, ''));
  assertThrows(() => posePatchRequest('https://x/api', '', 'i', { pitch: 1 }, 't'));
  assertEquals(posePatchRequest('https://x/api', 'c', 'i', {}, 't'), null);
});

Deno.test('posePatchRequest: corrected position rides in the same PATCH (#107)', () => {
  const req = posePatchRequest('https://x/api', 'c', 'i', { pitch: 1 }, 't', { latitude: 48.85, longitude: 2.35 });
  assertEquals(JSON.parse(req.init.body), { pitch: 1, latitude: 48.85, longitude: 2.35 });
  // position-only PATCH (no pose set) is valid too
  const posOnly = posePatchRequest('https://x/api', 'c', 'i', {}, 't', { latitude: 1, longitude: 2 });
  assertEquals(JSON.parse(posOnly.init.body), { latitude: 1, longitude: 2 });
  // partial/invalid position is ignored, not half-sent
  assertEquals(posePatchRequest('https://x/api', 'c', 'i', {}, 't', { latitude: 1 }), null);
});

Deno.test('offsetLngLat: metres east/north to lon/lat at latitude (#107)', () => {
  const [lon, lat] = offsetLngLat(2.35, 48.85, 10, -5);
  assertAlmostEquals(lat, 48.85 - 5 / 111320, 1e-12);
  assertAlmostEquals(lon, 2.35 + 10 / (111320 * Math.cos((48.85 * Math.PI) / 180)), 1e-12);
  assertEquals(offsetLngLat(2.35, 48.85, 0, 0), [2.35, 48.85]);
});

Deno.test('POSITION_STORE_KEY: per picture, distinct from the pose key (#107)', () => {
  assertEquals(POSITION_STORE_KEY('pic-1'), 'mapmax:pos:pic-1');
});

// --- Home instance ----------------------------------------------------------
// Items are read via the federated meta-catalog, which refuses PATCH (405);
// the write-back must target the owning instance from the `via` link.

Deno.test('homeApiBase: prefers the via link (the owning instance)', () => {
  const links = [
    { rel: 'self', href: 'https://api.panoramax.xyz/api/collections/c1/items/i1' },
    { rel: 'via', href: 'https://panoramax.openstreetmap.fr' },
  ];
  assertEquals(homeApiBase(links, links[0].href), 'https://panoramax.openstreetmap.fr/api');
});

Deno.test('homeApiBase: no via link → derived from the self href', () => {
  const self = 'https://panoramax.ign.fr/api/collections/c1/items/i1';
  assertEquals(homeApiBase([], self), 'https://panoramax.ign.fr/api');
  assertEquals(homeApiBase(undefined, self), 'https://panoramax.ign.fr/api');
});

Deno.test('apiBaseFromSelfHref: null on garbage', () => {
  assertEquals(apiBaseFromSelfHref(undefined), null);
  assertEquals(apiBaseFromSelfHref('not a url'), null);
});

// --- Exif pose --------------------------------------------------------------

Deno.test('readPoseFromExif: GPano pose fields, string or number', () => {
  assertEquals(readPoseFromExif({ 'Xmp.GPano.PosePitchDegrees': '2.5', 'Xmp.GPano.PoseRollDegrees': -1 }), { pitch: 2.5, roll: -1 });
  assertEquals(readPoseFromExif({}), { pitch: undefined, roll: undefined });
  assertEquals(readPoseFromExif(undefined), { pitch: undefined, roll: undefined });
});

// --- Pose matrix (the shader's maths) --------------------------------------

const azDir = (azDeg, elDeg = 0) => {
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
};
const EPS = 1e-9;

Deno.test('panoPoseMatrix: yaw-only reproduces the previous theta − panoYaw', () => {
  for (const yaw of [0, 37, 180, 271]) {
    const m = panoPoseMatrix(yaw, 0, 0);
    for (const az of [0, 45, 200, 300]) {
      const nc = poseTransform(m, azDir(az));
      const theta = Math.atan2(nc[0], nc[1]);
      const expected = Math.atan2(Math.sin(((az - yaw) * Math.PI) / 180), Math.cos(((az - yaw) * Math.PI) / 180));
      assertAlmostEquals(theta, expected, EPS);
    }
  }
});

Deno.test('panoPoseMatrix: the capture forward direction maps to the image centre', () => {
  // Camera yawed 40°, pitched up 25°: a world ray at azimuth 40 / elevation 25
  // must land at theta = 0, phi = 0 (u = v = 0.5).
  const m = panoPoseMatrix(40, 25, 0);
  const nc = poseTransform(m, azDir(40, 25));
  assertAlmostEquals(Math.atan2(nc[0], nc[1]), 0, EPS);
  assertAlmostEquals(Math.asin(nc[2]), 0, EPS);
});

Deno.test('panoPoseMatrix: pitch moves the horizon, roll tilts it', () => {
  // Camera pitched up 10°: the world horizon ahead (elevation 0) shows below
  // the image centre (negative phi).
  const up10 = poseTransform(panoPoseMatrix(0, 10, 0), azDir(0, 0));
  assertAlmostEquals(Math.asin(up10[2]), -10 * (Math.PI / 180), EPS);
  // Roll +90 (right-arm down): camera right points at the ground and camera up
  // at world east, so the world zenith lands on the camera's LEFT (−right).
  const z90 = poseTransform(panoPoseMatrix(0, 0, 90), [0, 0, 1]);
  assertAlmostEquals(z90[0], -1, EPS); // right component
  assertAlmostEquals(z90[1], 0, EPS);
  assertAlmostEquals(z90[2], 0, EPS);
});

Deno.test('panoPoseMatrix: stays orthonormal (no skew/scale for any pose)', () => {
  const m = panoPoseMatrix(123, -37, 21);
  const r = [m[0], m[3], m[6]], f = [m[1], m[4], m[7]], u = [m[2], m[5], m[8]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const v of [r, f, u]) assertAlmostEquals(dot(v, v), 1, EPS);
  assertAlmostEquals(dot(r, f), 0, EPS);
  assertAlmostEquals(dot(f, u), 0, EPS);
  assertAlmostEquals(dot(u, r), 0, EPS);
});

Deno.test('panoPoseMatrix: valid at pitch ±90 (no degenerate cross product)', () => {
  const m = panoPoseMatrix(0, 90, 0);
  const nc = poseTransform(m, [0, 0, 1]); // zenith = capture forward
  assertAlmostEquals(nc[1], 1, EPS);      // → image centre
});

Deno.test('POSE_STORE_KEY: namespaced per sequence', () => {
  assertEquals(POSE_STORE_KEY('seq-9'), 'mapmax:pose:seq-9');
});

// --- Edit-mode gesture maths (#106) ----------------------------------------

Deno.test('poseFromMatrix: exact roundtrip of panoPoseMatrix', () => {
  for (const [y, p, r] of [[0, 0, 0], [37, 12, -8], [208, -25, 14], [359, 44, -44], [90, 89, 30]]) {
    const back = poseFromMatrix(panoPoseMatrix(y, p, r));
    assertAlmostEquals(back.yaw, normalizeYaw(y), 1e-9);
    assertAlmostEquals(back.pitch, p, 1e-9);
    assertAlmostEquals(back.roll, r, 1e-9);
  }
});

Deno.test('poseFromMatrix: gimbal at pitch 90 still roundtrips the matrix', () => {
  const m = panoPoseMatrix(40, 90, 0);
  const back = poseFromMatrix(m);
  const m2 = panoPoseMatrix(back.yaw, back.pitch, back.roll);
  for (let i = 0; i < 9; i++) assertAlmostEquals(m2[i], m[i], 1e-9);
});

Deno.test('mat3Multiply / axisRotationMatrix: rotation about z matches the yaw pose', () => {
  // Our azimuth convention makes Rot(z, t) numerically equal to a yaw-only pose.
  const rz = axisRotationMatrix([0, 0, 1], 25);
  const yaw = panoPoseMatrix(25, 0, 0);
  for (let i = 0; i < 9; i++) assertAlmostEquals(rz[i], yaw[i], 1e-9);
  // identity times anything is a no-op
  const id = axisRotationMatrix([0, 0, 1], 0);
  const prod = mat3Multiply(id, yaw);
  for (let i = 0; i < 9; i++) assertAlmostEquals(prod[i], yaw[i], 1e-9);
});

Deno.test('composePoseGesture: horizontal drag is pure yaw, from any start pose', () => {
  const out = composePoseGesture({ yaw: 30, pitch: 0, roll: 0 }, { yawDeg: 120, pitchDeg: -10 }, { aboutUp: 10 });
  assertAlmostEquals(out.yaw, normalizeYaw(30 - 10), 1e-9); // photo turned, camera untouched
  assertAlmostEquals(out.pitch, 0, 1e-9);
  assertAlmostEquals(out.roll, 0, 1e-9);
});

Deno.test('composePoseGesture: vertical drag about the VIEW right axis', () => {
  // Convention locked by these tests: positive aboutRight INCREASES pitch when
  // looking north (camera yaw 0, right axis = east).
  const north = composePoseGesture({ yaw: 0, pitch: 5, roll: 0 }, { yawDeg: 0, pitchDeg: 0 }, { aboutRight: 8 });
  assertAlmostEquals(north.pitch, 5 + 8, 1e-6);
  assertAlmostEquals(north.roll, 0, 1e-6);
  // Looking EAST (camera yaw 90, right axis = south) at a yaw-0 photo: the
  // same world rotation reads as roll in the yaw/pitch/roll model — with the
  // opposite sign, because south = −north.
  const east = composePoseGesture({ yaw: 0, pitch: 0, roll: 0 }, { yawDeg: 90, pitchDeg: 0 }, { aboutRight: 8 });
  assertAlmostEquals(east.roll, -8, 1e-6);
  assertAlmostEquals(east.pitch, 0, 1e-6);
});

Deno.test('composePoseGesture: ring roll about the viewing axis', () => {
  // Looking north, level: forward = north → pure roll; positive adds roll.
  const out = composePoseGesture({ yaw: 0, pitch: 0, roll: 3 }, { yawDeg: 0, pitchDeg: 0 }, { aboutForward: 5 });
  assertAlmostEquals(out.roll, 3 + 5, 1e-6);
  assertAlmostEquals(out.pitch, 0, 1e-6);
  assertAlmostEquals(out.yaw, 0, 1e-6);
});

Deno.test('composePoseGesture: gestures keep the matrix orthonormal (no drift)', () => {
  let pose = { yaw: 12, pitch: 3, roll: -2 };
  for (let i = 0; i < 200; i++) {
    pose = composePoseGesture(pose, { yawDeg: (i * 7) % 360, pitchDeg: ((i % 40) - 20) }, { aboutUp: 0.7, aboutRight: -0.4, aboutForward: 0.2 });
  }
  const m = panoPoseMatrix(pose.yaw, pose.pitch, pose.roll);
  const r = [m[0], m[3], m[6]], f = [m[1], m[4], m[7]], u = [m[2], m[5], m[8]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const v of [r, f, u]) assertAlmostEquals(dot(v, v), 1, 1e-6);
  assertAlmostEquals(dot(r, f), 0, 1e-6);
});
