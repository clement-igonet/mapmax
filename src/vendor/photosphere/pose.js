// Capture-pose maths for the photosphere: yaw / pitch / roll of the camera
// that shot the panorama, and the gesture algebra of the pose editor. Pure —
// shared by the fragment shader (via uniformMatrix3fv), the visible-tile
// computation and the tests.
//
// Conventions (matching the shader): world x = east, y = north, z = up;
// azimuth measured from +y (north) toward +x (east).
//   yaw    0..360  world azimuth the image centre faces
//   pitch −90..90  horizon = 0, top = +90 (camera tilted up at capture)
//   roll  −90..90  flat = 0, right-arm down = +90

// Normalize any yaw to [0, 360) (−180 → 180, 540 → 180).
export const normalizeYaw = (deg) => ((deg % 360) + 360) % 360;

// World → camera-frame rotation of the capture pose. Returns the COLUMN-MAJOR
// 9-array for gl.uniformMatrix3fv of the matrix M with rows right/forward/up,
// so `M * dir` yields camera-frame coords and
//   theta = atan(nc.x, nc.y), phi = asin(nc.z)
// generalizes the yaw-only `atan(d.x, d.y) − panoYaw`.
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

// Apply the matrix to a world direction (JS twin of the GLSL `M * dir`).
export function poseTransform(m, v) {
    return [
        m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
        m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
        m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ];
}

// Column-major 3×3 product a·b.
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
    return {yaw: normalizeYaw(Y * r2d), pitch: P * r2d, roll: R * r2d};
}

// Compose a view-space editing gesture onto a pose (the algebra behind a
// "grab the photo" editor). `camera` = {yawDeg, pitchDeg} of the CURRENT look
// direction (the axes the user reasons in); deltas in degrees:
//   aboutUp      — horizontal drag: photo turns about the world vertical axis
//   aboutRight   — vertical drag: photo tilts about the view's horizontal
//                  lateral axis (stays horizontal whatever the look pitch)
//   aboutForward — roll control: photo rolls about the viewing axis
// Gestures compose as M' = M · G⁻¹ and re-extract yaw→pitch→roll, so repeated
// edits never skew or drift the pose.
export function composePoseGesture(pose, camera, {aboutUp = 0, aboutRight = 0, aboutForward = 0} = {}) {
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
