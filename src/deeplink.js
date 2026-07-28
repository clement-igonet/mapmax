// Deep-linking into a photosphere (#54).
//
// Reloading or sharing the URL should return you to the same place: inside the
// same 360° panorama (same look direction) or out on the map. The MapLibre
// `hash: true` handler owns the `#…` camera hash, so we keep our state in the
// QUERY STRING instead — `?pic=<id>&pv=<yaw>_<pitch>` — which MapLibre never
// touches, avoiding any read/write races.
//
// The core (parse/withPic/withoutPic) is pure and unit-tested; the browser
// wrappers read location.search and history.replaceState.

const PIC = 'pic';
const PV = 'pv'; // photosphere view: "<yaw>_<pitch>" (degrees)

const round1 = (n) => Math.round(n * 10) / 10;

// Parse `?pic=…&pv=…` into { id, yaw?, pitch? } or null. `search` may include the
// leading '?'.
export function parsePic(search) {
  const q = new URLSearchParams(search);
  const id = q.get(PIC);
  if (!id) return null;
  const out = { id };
  const pv = q.get(PV);
  if (pv) {
    const [y, p] = pv.split('_').map(Number);
    if (Number.isFinite(y)) out.yaw = y;
    if (Number.isFinite(p)) out.pitch = p;
  }
  return out;
}

// Return `search` (no leading '?') with pic/pv set. Other params are preserved.
export function withPic(search, id, yaw, pitch) {
  const q = new URLSearchParams(search);
  q.set(PIC, id);
  if (Number.isFinite(yaw) && Number.isFinite(pitch)) q.set(PV, `${round1(yaw)}_${round1(pitch)}`);
  else q.delete(PV);
  return q.toString();
}

// Return `search` (no leading '?') with pic/pv removed, other params preserved.
export function withoutPic(search) {
  const q = new URLSearchParams(search);
  q.delete(PIC);
  q.delete(PV);
  return q.toString();
}

// --- browser wrappers -------------------------------------------------------

function replaceSearch(nextSearch) {
  const s = nextSearch ? `?${nextSearch}` : '';
  history.replaceState(history.state, '', location.pathname + s + location.hash);
}

export const readPicFromUrl = () => parsePic(location.search);

export function writePicToUrl(id, yaw, pitch) {
  replaceSearch(withPic(location.search, id, yaw, pitch));
}

export function clearPicFromUrl() {
  const next = withoutPic(location.search);
  if (next !== location.search.replace(/^\?/, '')) replaceSearch(next);
}
