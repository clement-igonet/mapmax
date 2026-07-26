// Pure mapping: a normalized Panoramax picture → the photosphere plugin's
// {lngLat, imageUrl, bearing} target. Kept dependency-free so it is unit-tested
// offline (no maplibre-gl / WebGL). SD is used for snappy stepping; the entry
// picture can prefer the sharper HD asset.
export function pictureToTarget(pic, preferHd = false) {
  const a = pic.assets || {};
  const imageUrl = preferHd ? a.hd || a.sd || a.thumb : a.sd || a.hd || a.thumb;
  return { lngLat: [pic.lon, pic.lat], imageUrl, bearing: pic.heading || 0 };
}
