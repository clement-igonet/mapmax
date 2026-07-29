// Pure mapping: a normalized Panoramax picture → the photosphere plugin's
// {lngLat, imageUrl, bearing} target. Kept dependency-free so it is unit-tested
// offline (no maplibre-gl / WebGL). SD is used for snappy stepping; the entry
// picture can prefer the sharper HD asset.
export function pictureToTarget(pic, preferHd = false) {
  const a = pic.assets || {};
  const imageUrl = preferHd ? a.hd || a.sd || a.thumb : a.sd || a.hd || a.thumb;
  return { lngLat: [pic.lon, pic.lat], imageUrl, bearing: pic.heading || 0, roll: pic.roll || 0, pitch: pic.pitch || 0 };
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
