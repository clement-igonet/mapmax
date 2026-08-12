// Editing a picture's metadata at the source: the Panoramax API can PATCH a
// picture's pose (pitch / roll / yaw, API v2.14.0) and position (latitude /
// longitude, v2.8.0) on the instance that OWNS it. Everything here is pure —
// request builders and converters, no network, fully unit-tested.
//
// Pose domains (matching the API):
//   pitch  −90..90   horizon = 0, top = +90 (camera tilted up at capture)
//   roll   −90..90   flat = 0, right-arm down = +90
//   yaw    0..360    offset of the image centre from the GPS-derived direction

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

// Full fetch() arguments for the write-back. `position` (optional): corrected
// ABSOLUTE {latitude, longitude} rides in the same PATCH. Altitude has no API
// field. null when there is nothing to send.
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

// The API base of an item's HOME instance. Items read via the federated
// meta-catalog (api.panoramax.xyz) carry self links that stay on the catalog —
// which refuses PATCH (405); the `via` link names the owning instance
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
// & co. write PosePitchDegrees = 0.0 regardless — hence manual correctors).
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

// Apply an east/north offset in metres to a lon/lat (equirectangular local
// approximation — exact enough for the few metres a GPS correction needs).
export function offsetLngLat(lon, lat, eastM, northM) {
    const dLat = northM / 111320;
    const dLon = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lon + dLon, lat + dLat];
}
