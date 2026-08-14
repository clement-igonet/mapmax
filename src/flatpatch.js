// Flat pictures as located patches (#46): a non-360° photo enters the SAME
// photosphere, painted onto an equirectangular canvas over its real angular
// window — horizontal extent = the camera's field of view, vertical extent
// from the image aspect, centred on the horizon. The pano-yaw machinery does
// the world placement: the canvas centre (u = 0.5) is the image centre, and
// the target's panoYaw = capture heading points it the right way, so the
// photo hangs exactly where the camera looked. The rest of the sphere stays a
// neutral dark backdrop that the blend slider mixes with the vector map.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Pure: the destination rectangle of the flat image on the equirect canvas.
// hfovDeg is the horizontal field of view (degrees); vertical FOV derives from
// the image aspect through the pinhole model: vfov = 2·atan(tan(hfov/2)·h/w).
export function patchRect(hfovDeg, imgW, imgH, canvasW, canvasH) {
  const hfov = clamp(hfovDeg || 70, 10, 160);
  const vfovDeg = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * (imgH / imgW)) * 180) / Math.PI;
  const w = (canvasW * hfov) / 360;
  const h = (canvasH * clamp(vfovDeg, 5, 175)) / 180;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Panoramax and the Mapillary CDN serve CORS
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`flat image failed to load: ${url}`));
    img.src = url;
  });

let lastUrl = null; // previous blob URL — safe to revoke once a new one exists

// The flat photo as an equirectangular texture (blob URL) ready for the
// photosphere. Throws on load/canvas failure — callers fall back to the
// original-image popup (#40).
export async function flatPictureTexture(imageUrl, hfovDeg, { canvasW = 4096, canvasH = 2048 } = {}) {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, canvasW, canvasH);
  const r = patchRect(hfovDeg, img.naturalWidth || img.width, img.naturalHeight || img.height, canvasW, canvasH);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  // A hairline frame so the patch edge reads as a photo boundary, not a glitch.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  const url = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
  );
  if (lastUrl) URL.revokeObjectURL(lastUrl); // the GPU owns the previous texture by now
  lastUrl = url;
  return url;
}
