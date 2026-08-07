// MapMax entry point — MapLibre map (OSM ground + 3D buildings) with immersive
// Panoramax photospheres via the vendored maplibre-gl-photosphere plugin.
import * as maplibregl from 'maplibre-gl';
import { OSM_STYLE_URL, START_VIEW, MAP_MAX_PITCH, STREET_BUILDINGS_RADIUS_M, STREET_DEFAULT_BLEND } from './config.js';
import { MAPMAX_ENV } from './env.js';
import { buildingRadiusFilter, buildingsClipEnabled, parseRadiusOverride } from './buildings.js';
import { addPanoramaxLayers, onPictureClick, getPicture } from './panoramax.js';
import { _photosphere, applyPoseGesture, currentPicture, enterStreetView, exitStreetView, flipCurrentPano, getCurrentPose, getCurrentPositionOffset, isPoseEditMode, isStreetMode, nudgeCurrentPosition, onPictureChanged, resetCurrentPosition, savePoseToPanoramax, setBlend, setCurrentPose, setPoseEditMode } from './streetview.js';
import { claimPollDelays, parseGeneratedToken, tokenGenerateRequest, whoAmIRequest, PENDING_TOKEN_KEY, TOKEN_KEY } from './panoramaxauth.js';
import { isEquirectangular, originalImageUrl, picBadge, sliderToBlend } from './target.js';
import { setupNavigation } from './navigation.js';
import { setupControls } from './controls.js';
import { setupMinimap } from './minimap.js';
import { setupClutterCap } from './mapclutter.js';
import { clearPicFromUrl, readPicFromUrl, writePicToUrl } from './deeplink.js';
import { hardenStyle, transparentPixel } from './stylefix.js';
import { setupLicenseGate } from './licensegate.js';

// On the sandbox host, require a Polar license key before revealing the app
// (#76). No-op on www / localhost. Fire-and-forget: it mounts its own overlay.
setupLicenseGate();

const status = (msg) => {
  document.getElementById('hud-status').textContent = msg;
};

// The style is hardened BEFORE map creation so not a single frame renders
// raw null-able expressions (#14 — verified by the containerized Chromium e2e).
async function loadHardenedStyle() {
  try {
    const style = await (await fetch(OSM_STYLE_URL)).json();
    return hardenStyle(style);
  } catch (err) {
    console.warn('style hardening failed, using raw style', err);
    return OSM_STYLE_URL;
  }
}

export const map = new maplibregl.Map({
  container: 'map',
  style: await loadHardenedStyle(),
  ...START_VIEW,
  maxPitch: MAP_MAX_PITCH,
  // Keep the camera free of the ground plane so the photosphere plugin can sit
  // the eye at a fixed elevation (SPECIFICATIONS.md §2.2).
  centerClampedToGround: false,
  hash: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
setupNavigation(map);
setupControls(map);
setupMinimap(map);
// Cap the tilt so the map never renders 3D buildings + Panoramax dots out to the
// horizon; tilt unlocks as you zoom in (#41). Street mode manages its own pitch.
const applyClutterCap = setupClutterCap(map, isStreetMode);
// Re-apply on return to the map (street mode restored maxPitch to the hard max).
onPictureChanged((pic) => { if (!pic) applyClutterCap(); });

// Show the current picture's info in the page: a 360°/flat badge, the full id,
// the author and a link to the original image (#34, #40).
const picInfo = document.getElementById('pic-info');
function renderPicInfo(pic) {
  picInfo.replaceChildren();
  if (!pic) {
    picInfo.hidden = true;
    return;
  }
  const badge = document.createElement('span');
  badge.className = `pic-badge ${isEquirectangular(pic) ? 'is-360' : 'is-flat'}`;
  badge.textContent = picBadge(pic);
  picInfo.append(
    badge,
    document.createTextNode(` id ${pic.id}${pic.producer ? ` · by ${pic.producer}` : ''} · `)
  );
  const url = originalImageUrl(pic);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'View original ↗';
    picInfo.append(link);
  }
  picInfo.hidden = false;
}
onPictureChanged(renderPicInfo);

// Deep-link (#54): keep ?pic=<id>&pv=<yaw>_<pitch> in the URL so reloading or
// sharing returns you to the same photosphere (and look direction) or the map.
function revealStreetUI() {
  document.getElementById('exit-street').hidden = false;
  document.getElementById('blend-control').hidden = false;
  document.getElementById('minimap').hidden = false;
  document.getElementById('flip-pano').hidden = false;
  document.getElementById('pose-toggle').hidden = false;
}
let currentPic = null;
onPictureChanged((pic) => {
  currentPic = pic;
  const ps = _photosphere();
  if (pic) writePicToUrl(pic.id, ps?.yaw, ps?.pitch);
  else clearPicFromUrl();
});
// Update the saved look (yaw/pitch) as you drag / keyboard-look, debounced.
let urlSyncTimer = 0;
map.on('move', () => {
  if (!isStreetMode() || !currentPic) return;
  clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    if (isStreetMode() && currentPic) writePicToUrl(currentPic.id, _photosphere()?.yaw, _photosphere()?.pitch);
  }, 350);
});
// Restore an in-photosphere state from the URL once the map is ready.
map.on('load', async () => {
  const link = readPicFromUrl();
  if (!link) return;
  try {
    const pic = await getPicture(link.id);
    if (!isEquirectangular(pic)) return; // only 360° panoramas enter the sphere
    status('Restoring 360° panorama…');
    await enterStreetView(map, pic);
    revealStreetUI();
    status('360° panorama — drag to look, click a ground arrow to walk, Esc to exit.');
    if (Number.isFinite(link.yaw)) {
      const ps = _photosphere();
      const applyLook = () => {
        if (!ps) return;
        if (ps.mode === 'inside') {
          ps.look(link.yaw - ps.yaw, (Number.isFinite(link.pitch) ? link.pitch : ps.pitch) - ps.pitch);
        } else {
          requestAnimationFrame(applyLook);
        }
      };
      applyLook();
    }
  } catch (err) {
    console.error('deep-link restore failed', err);
  }
});

map.on('style.load', () => {
  ensureBuildings3D();
  addPanoramaxLayers(map);
  status('Zoom in and click a Panoramax picture dot.');
});

// Sprite icons referenced by the style but absent from its sprite sheet would
// log a warning per POI type; register a transparent placeholder. MapLibre main
// replaced the `styleimagemissing` event with setMissingStyleImageResolver()
// (which runs before the image is treated as missing) — use it when available,
// else fall back to the event.
const addPlaceholder = (id) => {
  if (!map.hasImage(id)) map.addImage(id, transparentPixel());
};
if (typeof map.setMissingStyleImageResolver === 'function') {
  map.setMissingStyleImageResolver((id) => addPlaceholder(id));
} else {
  map.on('styleimagemissing', (e) => addPlaceholder(e.id));
}

onPictureClick(map, async (id) => {
  status('Loading picture metadata…');
  const watchdog = setInterval(
    () => status('Still loading — street-level images can be large…'),
    8000
  );
  try {
    const pic = await getPicture(id);
    // Flat (non-360) pictures can't be a photosphere — don't wrap them onto the
    // sphere. Show the original in a popup instead (#40). 360° panoramas enter.
    if (!isEquirectangular(pic)) {
      showFlatPicture(pic);
      status('Flat photo (not a 360° panorama) — opened the original. Blue dots are 360°.');
      return;
    }
    status('Loading image…');
    await enterStreetView(map, pic);
    revealStreetUI();
    status('360° panorama — drag to look, click a ground arrow to walk, Esc to exit.');
  } catch (err) {
    console.error(err);
    status(`Failed to load picture: ${err.message || 'image could not be loaded'}`);
  } finally {
    clearInterval(watchdog);
  }
});

// A flat picture: show its original image (oriented by its compass heading) in
// a popup rather than a broken sphere — an oriented in-sphere patch is a
// follow-up (#40).
function showFlatPicture(pic) {
  const url = originalImageUrl(pic);
  const heading = Math.round(pic.heading || 0);
  new maplibregl.Popup({ maxWidth: '360px' })
    .setLngLat([pic.lon, pic.lat])
    .setHTML(
      `<div class="flat-popup">
        <a href="${url}" target="_blank" rel="noopener"><img src="${pic.assets.sd || pic.assets.thumb || url}" alt="flat picture"></a>
        <div class="flat-meta"><b>flat photo</b> · heading ${heading}° · by ${escapeHtml(pic.producer || 'unknown')}<br>
        Not a 360° panorama. <a href="${url}" target="_blank" rel="noopener">View original ↗</a></div>
      </div>`
    )
    .addTo(map);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const blendSlider = document.getElementById('blend');
blendSlider.addEventListener('input', () => {
  setBlend(sliderToBlend(blendSlider.value));
});

const exitBtn = document.getElementById('exit-street');
const leaveStreetUI = () => {
  exitBtn.hidden = true;
  document.getElementById('blend-control').hidden = true;
  document.getElementById('minimap').hidden = true;
  document.getElementById('flip-pano').hidden = true;
  document.getElementById('pose-toggle').hidden = true;
  document.getElementById('pose-panel').hidden = true;
  setEditModeUI(false); // never leave photo-drag mode armed outside the panel (#106)
  // Back to the 50/50 default for the next entry (#101) — streetview.js resets
  // its remembered blend on exit to match.
  blendSlider.value = String(STREET_DEFAULT_BLEND * 100);
  status('Zoom in and click a Panoramax picture dot.');
};
// EVERY exit path (✕ Map, Esc, plugin-internal exits) reports pic = null —
// hide the street controls from this one place so none can leave the pose
// panel dangling over the map, where Connect/Save have nothing to act on (#104).
onPictureChanged((pic) => { if (!pic) leaveStreetUI(); });

// Manual 180° flip for a mis-oriented sequence (#69) — backstop when the sun
// compass can't see the sun (evening rides, narrow alleys). Persists per
// sequence and re-renders immediately.
document.getElementById('flip-pano').addEventListener('click', () => {
  const applied = flipCurrentPano();
  if (applied != null) status(`Photo rotated ${applied ? '180°' : 'back to metadata orientation'} for this sequence.`);
  syncPosePanel();
});

// Pose leveller (#98): pitch/roll/yaw sliders apply live (and persist per
// sequence in this browser); with a Panoramax token the pose is PATCHed back
// to the picture's home instance so the fix holds for every viewer.
const posePanel = document.getElementById('pose-panel');
const poseStatus = document.getElementById('pose-status');
const poseTokenInput = document.getElementById('pose-token');
const POSE_STATUS_DEFAULT = poseStatus.textContent;
// The gestures ARE the controls (#106); this read-out just mirrors them.
// Yaw is shown in ±180 around the GPS direction; storage/PATCH use [0,360).
const poseRotVal = document.getElementById('pose-rot-val');
const yawToSigned = (yaw) => (yaw > 180 ? yaw - 360 : yaw);

// The manual token link is a FALLBACK: pointless once a token is present
// (connected or pasted), so it only shows while the field is empty (#104).
const poseHelp = document.getElementById('pose-token-help');
const syncPoseHelp = () => {
  poseHelp.hidden = !!poseTokenInput.value.trim();
};
poseTokenInput.addEventListener('input', syncPoseHelp);

function syncPosePanel() {
  const pose = getCurrentPose();
  if (!pose || posePanel.hidden) return;
  poseRotVal.textContent =
    `Pitch ${pose.pitch.toFixed(1)}° · Roll ${pose.roll.toFixed(1)}° · Yaw ${yawToSigned(pose.yaw).toFixed(0)}°`;
  // Token help goes to the CURRENT picture's home instance (that's where the
  // PATCH lands): sign in there, then this endpoint lists your tokens.
  const home = currentPicture()?.homeApi;
  if (home) poseHelp.href = `${home}/users/me/tokens`;
  syncPoseHelp();
}
onPictureChanged(() => syncPosePanel());

// Token lookup for the CURRENT picture's home instance — tokens are only valid
// on the instance that issued them, so they're stored per instance (#104). The
// un-keyed legacy entry is kept as a read fallback.
const storedToken = () => {
  const home = currentPicture()?.homeApi;
  return (home && sessionStorage.getItem(TOKEN_KEY(home))) || sessionStorage.getItem('mapmax:panoramax-token') || '';
};

// The OAuth claim can complete AFTER the Connect poll gave up (slow sign-in,
// tab left open, page reloaded meanwhile): the generated JWT is remembered per
// instance (PENDING_TOKEN_KEY) and re-checked here on panel open and on Save,
// so a finished sign-in is adopted no matter when it finished (#104).
async function adoptPendingToken() {
  const home = currentPicture()?.homeApi;
  if (!home) return false;
  const pending = sessionStorage.getItem(PENDING_TOKEN_KEY(home));
  if (!pending) return false;
  const who = whoAmIRequest(home, pending);
  const res = await fetch(who.url, who.init).catch(() => null);
  if (!res?.ok) return false; // not claimed yet — keep it pending
  const me = await res.json().catch(() => ({}));
  sessionStorage.removeItem(PENDING_TOKEN_KEY(home));
  sessionStorage.setItem(TOKEN_KEY(home), pending); // session only
  poseTokenInput.value = pending;
  syncPoseHelp();
  poseStatus.textContent = `Connected${me.name ? ` as ${me.name}` : ''} — Save to Panoramax is ready.`;
  return true;
}

document.getElementById('pose-toggle').addEventListener('click', () => {
  posePanel.hidden = !posePanel.hidden;
  if (!posePanel.hidden) {
    poseTokenInput.value = storedToken();
    poseStatus.textContent = POSE_STATUS_DEFAULT;
    syncPosePanel();
    if (!poseTokenInput.value) adoptPendingToken(); // fire-and-forget check
  } else {
    setEditModeUI(false); // closing the panel closes edit mode with it (#106)
  }
});

// "Connect to Panoramax" (#104): generate an unclaimed token on the picture's
// home instance, open its claim URL (the instance's OAuth / OSM login) in a new
// tab, and poll users/me with the JWT until the account binds it.
const poseConnectBtn = document.getElementById('pose-connect');
poseConnectBtn.addEventListener('click', async () => {
  const pic = currentPicture();
  if (!pic) {
    poseStatus.textContent = 'Enter a 360° panorama first — the connection targets the instance that hosts the current picture.';
    return;
  }
  // Open the tab synchronously (inside the click) so popup blockers allow it.
  const claimTab = window.open('', '_blank');
  poseConnectBtn.disabled = true;
  let home = pic.homeApi;
  if (!home) {
    // Some fetch paths can miss the `via` link — refetch the item for it.
    try { home = (await getPicture(pic.id))?.homeApi; } catch { /* handled below */ }
  }
  if (!home) {
    if (claimTab) claimTab.close();
    poseConnectBtn.disabled = false;
    poseStatus.textContent = 'Unknown home instance for this picture — paste a token instead.';
    return;
  }
  try {
    const gen = tokenGenerateRequest(home);
    const res = await fetch(gen.url, gen.init);
    const parsed = parseGeneratedToken(await res.json());
    if (!parsed) throw new Error(`no claimable token from ${home}`);
    // Survive the poll's lifetime: adopted later from panel-open/Save (#104).
    sessionStorage.setItem(PENDING_TOKEN_KEY(home), parsed.jwt);
    if (claimTab) claimTab.location = parsed.claimUrl;
    else {
      // Popup blocked: hand the claim URL to the help link instead.
      poseHelp.href = parsed.claimUrl;
      poseHelp.textContent = 'Pop-up blocked — open the sign-in page manually ↗';
      poseHelp.hidden = false;
    }
    poseStatus.textContent = 'Sign in with your OpenStreetMap account in the opened tab — waiting for the connection…';
    for (const delay of claimPollDelays()) {
      await new Promise((r) => setTimeout(r, delay));
      if (posePanel.hidden) return; // panel closed — stop polling quietly
      const who = whoAmIRequest(home, parsed.jwt);
      const meRes = await fetch(who.url, who.init).catch(() => null);
      if (meRes?.ok) {
        const me = await meRes.json().catch(() => ({}));
        sessionStorage.removeItem(PENDING_TOKEN_KEY(home));
        sessionStorage.setItem(TOKEN_KEY(home), parsed.jwt); // session only
        poseTokenInput.value = parsed.jwt;
        syncPoseHelp(); // token present — the manual fallback link disappears
        poseStatus.textContent = `Connected${me.name ? ` as ${me.name}` : ''} — Save to Panoramax is ready.`;
        return;
      }
    }
    poseStatus.textContent = 'Still waiting for the sign-in — finish it in the opened tab, then press Save: the connection is picked up automatically.';
  } catch (err) {
    if (claimTab) claimTab.close();
    poseStatus.textContent = `Connect failed: ${err?.message || 'network error'}. You can paste a token instead.`;
  } finally {
    poseConnectBtn.disabled = false;
  }
});

document.getElementById('pose-reset').addEventListener('click', () => {
  setCurrentPose({ pitch: 0, roll: 0, yaw: 0 });
  resetCurrentPosition(); // #107: back to the GPS position and default eye height
  syncPosePanel();
  syncRing();
  syncPosVal();
  syncElev();
  poseStatus.textContent = 'Pose and position reset to the picture metadata.';
});

// Pose edit mode (#106): drag rotates the photo (yaw/pitch), the ring rolls it.
const poseEditBtn = document.getElementById('pose-edit');
const poseRing = document.getElementById('pose-ring');
const poseRingHandle = document.getElementById('pose-ring-handle');

// The handle orbits by rotating the (visually symmetric) ring container.
function syncRing() {
  if (poseRing.hidden) return;
  poseRing.style.transform = `rotate(${getCurrentPose()?.roll || 0}deg)`;
}

// Position read-out (#107): metre offsets east/north/up of the current pano.
const posRow = document.getElementById('pose-pos-row');
const posVal = document.getElementById('pose-pos-val');
function syncPosVal() {
  const o = getCurrentPositionOffset();
  if (o) posVal.textContent = `ΔE ${o.e.toFixed(1)} · ΔN ${o.n.toFixed(1)} · ΔH ${o.u.toFixed(2)} m`;
}

// Elevation scale (#107): a vertical gauge right of the ring — the handle
// position maps linearly onto the eye-height offset range.
const ELEV_MIN = -3, ELEV_MAX = 6;
const poseElev = document.getElementById('pose-elev');
const poseElevTrack = document.getElementById('pose-elev-track');
const poseElevHandle = document.getElementById('pose-elev-handle');
const poseElevVal = document.getElementById('pose-elev-val');
function syncElev() {
  if (poseElev.hidden) return;
  const u = getCurrentPositionOffset()?.u || 0;
  const frac = (ELEV_MAX - u) / (ELEV_MAX - ELEV_MIN); // 0 at top (+6) … 1 at bottom (−3)
  poseElevHandle.style.top = `${(frac * 100).toFixed(2)}%`;
  poseElevVal.textContent = `${u >= 0 ? '+' : ''}${u.toFixed(2)} m`;
}
let elevDragging = false;
const elevFromPointer = (e) => {
  const r = poseElevTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
  return ELEV_MAX - frac * (ELEV_MAX - ELEV_MIN);
};
poseElevHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  try { poseElevHandle.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  elevDragging = true;
});
poseElevHandle.addEventListener('pointermove', (e) => {
  if (!elevDragging) return;
  const target = elevFromPointer(e);
  const now = getCurrentPositionOffset()?.u || 0;
  nudgeCurrentPosition({ upM: target - now });
  syncElev();
  syncPosVal();
});
poseElevHandle.addEventListener('pointerup', () => { elevDragging = false; });
poseElevHandle.addEventListener('pointercancel', () => { elevDragging = false; });

// Minimap drag (#107): in edit mode, dragging the minimap moves the panorama
// on the 2D ground plan — grab-the-world: the dots follow the cursor. The
// minimap draws at a fixed metric scale (0.6 m/px, minimap.js).
const MINIMAP_M_PER_PX = 0.6;
const minimapEl = document.getElementById('minimap');
let minimapDrag = null;
minimapEl.addEventListener('pointerdown', (e) => {
  if (!isPoseEditMode()) return;
  e.preventDefault();
  e.stopPropagation();
  try { minimapEl.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  minimapDrag = { x: e.clientX, y: e.clientY };
});
minimapEl.addEventListener('pointermove', (e) => {
  if (!minimapDrag) return;
  const dx = e.clientX - minimapDrag.x;
  const dy = e.clientY - minimapDrag.y;
  minimapDrag = { x: e.clientX, y: e.clientY };
  // Screen y grows southward on the north-up minimap.
  nudgeCurrentPosition({ eastM: -dx * MINIMAP_M_PER_PX, northM: dy * MINIMAP_M_PER_PX });
  syncPosVal();
});
minimapEl.addEventListener('pointerup', () => { minimapDrag = null; });
minimapEl.addEventListener('pointercancel', () => { minimapDrag = null; });

function setEditModeUI(on) {
  const actual = setPoseEditMode(on, () => { syncPosePanel(); syncRing(); syncPosVal(); syncElev(); });
  poseEditBtn.classList.toggle('active', actual);
  poseRing.hidden = !actual;
  poseElev.hidden = !actual;
  posRow.hidden = !actual;
  minimapEl.classList.toggle('minimap-editable', actual);
  if (actual) {
    syncRing();
    syncElev();
    syncPosVal();
    poseStatus.textContent = 'Edit mode — drag the photo to turn/tilt it, ring = horizon, scale = eye height, ⇧-drag or drag the minimap = move the position. Esc leaves edit mode.';
  }
  return actual;
}

poseEditBtn.addEventListener('click', () => {
  const on = setEditModeUI(!isPoseEditMode());
  if (!on) poseStatus.textContent = POSE_STATUS_DEFAULT;
});

// Ring drag: the angle around the screen centre maps to roll about the
// viewing axis (clockwise on screen = positive, matching composePoseGesture).
let ringLastAngle = null;
const ringAngle = (e) => {
  const r = poseRing.getBoundingClientRect();
  return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
};
poseRingHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  try { poseRingHandle.setPointerCapture(e.pointerId); } catch { /* synthetic events (tests) have no real pointer */ }
  ringLastAngle = ringAngle(e);
});
poseRingHandle.addEventListener('pointermove', (e) => {
  if (ringLastAngle == null) return;
  const a = ringAngle(e);
  let delta = a - ringLastAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  ringLastAngle = a;
  applyPoseGesture({ aboutForward: delta });
  syncPosePanel();
  syncRing();
});
poseRingHandle.addEventListener('pointerup', () => { ringLastAngle = null; });
poseRingHandle.addEventListener('pointercancel', () => { ringLastAngle = null; });

document.getElementById('pose-save').addEventListener('click', async () => {
  let token = poseTokenInput.value.trim();
  // A sign-in finished after the poll gave up? Adopt it now and save through.
  if (!token && await adoptPendingToken()) token = poseTokenInput.value.trim();
  if (!token) {
    poseStatus.textContent = 'No token — the correction stays in this browser only. Use Connect, or paste a Panoramax API token, to fix it at the source.';
    return;
  }
  const home = currentPicture()?.homeApi;
  sessionStorage.setItem(home ? TOKEN_KEY(home) : 'mapmax:panoramax-token', token); // session only — never persisted
  poseStatus.textContent = 'Saving pose to Panoramax…';
  const res = await savePoseToPanoramax(token);
  poseStatus.textContent = res.ok
    ? `Saved — pose${getCurrentPositionOffset()?.e || getCurrentPositionOffset()?.n ? ' and position' : ''} corrected on Panoramax for every viewer.${res.altitudeLocalOnly ? ' (Altitude has no API field — it stays local.)' : ''}`
    : `Save failed: ${res.error || res.status}. The correction still applies in this browser.`;
});
exitBtn.addEventListener('click', () => {
  if (isStreetMode()) exitStreetView();
  leaveStreetUI();
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Esc peels one layer at a time: edit mode first, then street view (#106).
  if (isPoseEditMode()) {
    setEditModeUI(false);
    poseStatus.textContent = POSE_STATUS_DEFAULT;
    return;
  }
  if (isStreetMode()) exitStreetView();
  leaveStreetUI();
});

map.on('error', (e) => {
  console.error('Map error', e.error);
});

// The Liberty style ships a `building-3d` fill-extrusion layer; if the style
// ever changes, add our own extrusion from the OSM `building` source layer.
// Buildings are held to zoom ≥ 18 (#82): a layer's minzoom is a global map-zoom
// gate, so buildings show only once you're zoomed right in — near, at street
// scale. Below z18 they'd be far clutter. No per-distance culling — the zoom
// gate alone keeps them near (the distance budget, kept simple).
const BUILDINGS_MIN_ZOOM = 18;
function ensureBuildings3D() {
  const style = map.getStyle();
  const existing = style.layers.filter((l) => l.type === 'fill-extrusion');
  if (existing.length) {
    // Hold the style's own extrusions (Liberty `building-3d`) to z18+.
    for (const l of existing) {
      try { map.setLayerZoomRange(l.id, BUILDINGS_MIN_ZOOM, 24); } catch { /* ignore */ }
    }
    return;
  }

  const buildingLayer = style.layers.find((l) => l['source-layer'] === 'building');
  if (!buildingLayer) {
    console.warn('No building source-layer found in style; skipping 3D buildings.');
    return;
  }
  map.addLayer({
    id: 'mapmax-buildings-3d',
    type: 'fill-extrusion',
    source: buildingLayer.source,
    'source-layer': 'building',
    minzoom: BUILDINGS_MIN_ZOOM,
    paint: {
      'fill-extrusion-color': 'hsl(35,8%,85%)',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.8,
    },
  });
}

// Inside a photosphere the map zoom is DERIVED from the look direction (the
// plugin re-derives it each look), so it drifts with pitch — and the z18
// building gate then toggles the WHOLE layer on/off as you look around: a 1°
// pitch change can flip every building (#87). While inside the sphere, pin the
// gate below the street-mode zoom so buildings stay stable across all pitches;
// restore the z18 near-only gate on exit (map mode is unaffected).
const STREET_BUILDINGS_MIN_ZOOM = 15;
function setBuildingsGate(minz) {
  for (const l of map.getStyle().layers) {
    if (l.type !== 'fill-extrusion') continue;
    try { map.setLayerZoomRange(l.id, minz, 24); } catch { /* ignore */ }
  }
}

// Clip 3D buildings to a radius around the standpoint in street mode (#95),
// enabled in every env (promoted to prod after staging validation). The radius
// is runtime-variable — ?buildingsRadius=<m> in the URL, or
// window.setBuildingsRadius(m) in the console; 0 disables. `center` null (map
// mode) restores each layer's original filter. Filter builder is unit-tested.
const buildingsClipOn = buildingsClipEnabled(MAPMAX_ENV);
let buildingsRadiusM = parseRadiusOverride(location.search, STREET_BUILDINGS_RADIUS_M);
let buildingsStandpoint = null;
const origBuildingFilter = new Map();
function setBuildingsRadius(center) {
  // Off on www (and in e2e): never touch layer filters — calling setFilter
  // re-validates the style and surfaces latent warnings from other layers (#95).
  if (!buildingsClipOn) return;
  const clip = center && buildingsRadiusM > 0;
  for (const l of map.getStyle().layers) {
    if (l.type !== 'fill-extrusion') continue;
    if (!origBuildingFilter.has(l.id)) origBuildingFilter.set(l.id, map.getFilter(l.id) ?? null);
    const orig = origBuildingFilter.get(l.id);
    try {
      // validate:false — setFilter's built-in validation re-checks the whole
      // style and can re-surface already-hardened filters' null warnings in the
      // street-mode state (#95); the filter we pass is built here and safe.
      map.setFilter(l.id, clip ? buildingRadiusFilter(orig, center.lng, center.lat, buildingsRadiusM) : orig, { validate: false });
    } catch { /* ignore */ }
  }
}
// Live tuning from the console (sandbox): e.g. window.setBuildingsRadius(80).
window.setBuildingsRadius = (m) => {
  buildingsRadiusM = Number(m) || 0;
  setBuildingsRadius(buildingsStandpoint);
  return buildingsRadiusM;
};

onPictureChanged((pic) => {
  setBuildingsGate(pic ? STREET_BUILDINGS_MIN_ZOOM : BUILDINGS_MIN_ZOOM);
  buildingsStandpoint = pic ? { lng: pic.lon, lat: pic.lat } : null;
  setBuildingsRadius(buildingsStandpoint);
});
