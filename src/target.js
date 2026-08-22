// Pure mapping: a normalized Panoramax picture → the photosphere plugin's
// {lngLat, imageUrl, bearing} target. Kept dependency-free so it is unit-tested
// offline (no maplibre-gl / WebGL). SD is used for snappy stepping; the entry
// picture can prefer the sharper HD asset.
// GPU FOOTPRINT (#172): a 5760×2880 panorama is ~66 MB of GPU memory as an
// RGBA texture. On a machine already under raster-memory pressure (many tabs,
// several MapMax instances) Chrome starts evicting tiles and overlay controls
// stop painting — observed repeatedly. The SD asset (~2048 wide) is ~8× cheaper
// and, on a sphere at typical FOV, near-indistinguishable; HD stays available
// with ?hd=1 for a machine with headroom.
const HD_OPT_IN = (() => {
  try { return new URLSearchParams(globalThis.location?.search || '').get('hd') === '1'; } catch { return false; }
})();

export function pictureToTarget(pic, preferHd = false) {
  const a = pic.assets || {};
  const imageUrl = preferHd && HD_OPT_IN ? a.hd || a.sd || a.thumb : a.sd || a.hd || a.thumb;
  // bearing = travel/look direction; panoYaw = where the image CENTRE really
  // points — differs by 180° when a backward-mounted camera was detected via
  // the sun compass (pic.yawOffset, #66).
  const bearing = pic.heading || 0;
  return {
    lngLat: [pic.lon, pic.lat],
    imageUrl,
    bearing,
    panoYaw: (bearing + (pic.yawOffset || 0)) % 360,
    // Capture pose to undo in the shader (#98): localStorage/exif-resolved.
    panoPitch: pic.posePitch || 0,
    panoRoll: pic.poseRoll || 0,
    // Tiled HD derivate → progressive refinement (plugin 0.3.0), when known.
    // Progressive HD tiles allocate another large atlas — same opt-in.
    tiles: HD_OPT_IN ? pic.tiles || null : null,
  };
}

// Blend slider (0..100, %) → photo opacity (1..0). 100% = photo only,
// 0% = vector only, in between = mixed (mapmax #6).
export function sliderToBlend(percent) {
  const p = Math.max(0, Math.min(100, Number(percent)));
  return p / 100;
}

// One-line info shown in the page for the current picture (#34): type, id and
// author. The full id is kept intact so it can be selected/copied.
export function formatPicInfo(pic) {
  if (!pic) return '';
  const parts = [pic.type || 'picture', `id ${pic.id}`];
  if (pic.producer) parts.push(`by ${pic.producer}`);
  return parts.join(' · ');
}

// Projection badge label for the HUD (#40).
export const isEquirectangular = (pic) => pic?.type === 'equirectangular';
export const picBadge = (pic) => (isEquirectangular(pic) ? '360°' : 'flat');

// URL of the full-resolution original image, to view it as-is (#40).
export const originalImageUrl = (pic) => pic?.assets?.hd || pic?.assets?.sd || pic?.assets?.thumb || '';
