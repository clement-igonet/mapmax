// MapMax entry point — MapLibre map (OSM ground + 3D buildings) with immersive
// Panoramax photospheres via the vendored maplibre-gl-photosphere plugin.
import * as maplibregl from 'maplibre-gl';
import { OSM_STYLE_URL, START_VIEW, MAP_MAX_PITCH, STREET_BUILDINGS_RADIUS_M, STREET_DEFAULT_BLEND } from './config.js';
import { MAPMAX_ENV } from './env.js';
import { buildingRadiusFilter, buildingsClipEnabled, parseRadiusOverride } from './buildings.js';
import { panoramaxSource } from './panoramax.js';
import { mapillarySource, mapillaryToken } from './mapillary.js';
import { commonsSource } from './commons.js';
import { registerSource, addCoverage, onPictureClick, getPicture, isEditable, allSources, sourceOf, setSourceVisible, encodePicRef, decodePicRef } from './sources.js';
import { _photosphere, applyPoseGesture, enterStreetView, exitStreetView, flipCurrentPano, getCurrentPose, getCurrentPositionOffset, isPoseEditMode, isStreetMode, nudgeCurrentPosition, onPictureChanged, resetCurrentPosition, setBlend, setCurrentPose, setPoseEditMode } from './streetview.js';
import { isEquirectangular, originalImageUrl, picBadge, sliderToBlend } from './target.js';
import { setupNavigation } from './navigation.js';
import { setupControls } from './controls.js';
import { setupMinimap } from './minimap.js';
import { setupClutterCap } from './mapclutter.js';
import { clearPicFromUrl, readPicFromUrl, writePicToUrl } from './deeplink.js';
import { hardenStyle, transparentPixel } from './stylefix.js';
import { BAND_DEG, photoStrip, poseStrip, scanWorldStrip, stripProfiles } from './autoscan.js';
import { fitTilt, isConfident, proposeYawDelta, tiltIsUsable } from './autoyaw.js';
import { setupLicenseGate } from './licensegate.js';

// The sources this build browses (#112) — Panoramax is the backbone (first
// registered = default source for bare picture ids); Mapillary joins when a
// client token is configured (config.js or ?mapillary_token=…).
registerSource(panoramaxSource);
if (mapillaryToken()) registerSource(mapillarySource);
registerSource(commonsSource); // tokenless — Pano360 POI spheres (#112)

// On the sandbox host, require a Polar license key before revealing the app
// (#76). No-op on www / localhost. Fire-and-forget: it mounts its own overlay.
setupLicenseGate();

const status = (msg) => {
  document.getElementById('hud-status').textContent = msg;
};

// The style is hardened BEFORE map creation so not a single frame renders
// raw null-able expressions (#14 — verified by the containerized Chromium e2e).
// The fetch retries: a single transient failure would otherwise fall back to
// the RAW style URL for the whole session — MapLibre's own fetch then succeeds
// and every null-able filter warns on evaluation (seen once in CI when the
// upstream style had just been republished).
async function loadHardenedStyle() {
  for (let attempt = 1; ; attempt++) {
    try {
      const style = await (await fetch(OSM_STYLE_URL)).json();
      return hardenStyle(style);
    } catch (err) {
      if (attempt >= 3) {
        console.warn('style hardening failed, using raw style', err);
        return OSM_STYLE_URL;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
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
  // Source + license make the multi-source reality visible per picture (#112):
  // "360° · Mapillary · CC-BY-SA-4.0 · by …".
  const src = sourceOf(pic);
  const provenance = [src?.name, pic.license].filter(Boolean).join(' · ');
  picInfo.append(
    badge,
    document.createTextNode(
      `${provenance ? ` ${provenance} ·` : ''} id ${pic.id}${pic.producer ? ` · by ${pic.producer}` : ''} · `
    )
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
function revealStreetUI(pic) {
  document.getElementById('exit-street').hidden = false;
  document.getElementById('blend-control').hidden = false;
  document.getElementById('minimap').hidden = false;
  // The header's Edit entry (#111) arms only inside a panorama, and only for
  // sources whose corrections have somewhere to live (#112) — with Panoramax
  // that is the browser's localStorage.
  const editMain = document.getElementById('edit-main');
  editMain.disabled = !isEditable(pic);
  editMain.title = editMain.disabled
    ? 'This source is read-only — corrections are not available'
    : 'Fix this panorama\'s orientation and position — in your browser only';
}
let currentPic = null;
onPictureChanged((pic) => {
  currentPic = pic;
  const ps = _photosphere();
  if (pic) writePicToUrl(encodePicRef(pic), ps?.yaw, ps?.pitch);
  else clearPicFromUrl();
});
// Update the saved look (yaw/pitch) as you drag / keyboard-look, debounced.
let urlSyncTimer = 0;
map.on('move', () => {
  if (!isStreetMode() || !currentPic) return;
  clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    if (isStreetMode() && currentPic) writePicToUrl(encodePicRef(currentPic), _photosphere()?.yaw, _photosphere()?.pitch);
  }, 350);
});
// Restore an in-photosphere state from the URL once the map is ready.
map.on('load', async () => {
  const link = readPicFromUrl();
  if (!link) return;
  try {
    const ref = decodePicRef(link.id);
    const pic = await getPicture(ref.id, ref.sourceId);
    status(isEquirectangular(pic) ? 'Restoring 360° panorama…' : 'Restoring photo…'); // flat enters as a patch too (#46)
    await enterStreetView(map, pic);
    revealStreetUI(pic);
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

// The browse prompt names every registered source — the map is not
// Panoramax-only anymore (#112).
const browsePrompt = () =>
  `Zoom in and click a picture dot (${allSources().map((s) => s.name).join(' + ')}).`;

// Source legend (#112): one chip per registered source, colored like its dots;
// click toggles that source's coverage. Small OPAQUE chips, no transitions —
// large translucent/promoted surfaces over WebGL rasterize unreliably (#100).
const sourceShown = new Map();
function buildSourceLegend() {
  const legend = document.getElementById('source-legend');
  legend.replaceChildren();
  for (const s of allSources()) {
    sourceShown.set(s.id, sourceShown.get(s.id) ?? true);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'source-chip';
    // The chip previews the ACTUAL dot colors (#125): one swatch per type,
    // matching what renders on the map and the sphere floor — a single brand
    // color taught the wrong mapping (orange chip vs blue 360° dots).
    for (const kind of ['equirectangular', 'flat']) {
      const hex = s.dotColors?.[kind];
      if (!hex) continue;
      const dot = document.createElement('span');
      dot.className = 'source-swatch';
      dot.style.background = hex;
      chip.append(dot);
    }
    chip.append(document.createTextNode(s.name));
    chip.title = `${s.name} — first swatch: 360° dots, second: flat photos. Click to show/hide its coverage.`;
    chip.classList.toggle('chip-off', !sourceShown.get(s.id));
    chip.addEventListener('click', () => {
      const on = !sourceShown.get(s.id);
      sourceShown.set(s.id, on);
      setSourceVisible(map, s.id, on);
      chip.classList.toggle('chip-off', !on);
    });
    legend.append(chip);
  }
}
buildSourceLegend();

map.on('style.load', () => {
  ensureBuildings3D();
  addCoverage(map);
  // A style reload re-adds coverage with default visibility — reapply the
  // legend's toggles so a hidden source stays hidden.
  for (const [id, on] of sourceShown) if (!on) setSourceVisible(map, id, false);
  status(browsePrompt());
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

onPictureClick(map, async (id, _feature, src) => {
  status('Loading picture metadata…');
  const watchdog = setInterval(
    () => status('Still loading — street-level images can be large…'),
    8000
  );
  try {
    // Ask the adapter whose layer was clicked — a Mapillary id 400s on the
    // Panoramax API (#112).
    const pic = await getPicture(id, src?.id);
    // Flat (non-360) pictures enter the SAME photosphere, placed as a located
    // patch at their capture heading and field of view (#46) — never stretched
    // over the whole sphere (#40). The original-image popup remains the
    // fallback when the image can't be textured (CORS, decode failure).
    if (!isEquirectangular(pic)) {
      try {
        status('Loading image…');
        await enterStreetView(map, pic);
        revealStreetUI(pic);
        status('Flat photo placed at its capture heading — drag to look around it, Esc to exit.');
      } catch (err) {
        console.warn('flat patch failed, falling back to the popup (#46)', err);
        showFlatPicture(pic);
        status('Flat photo — could not place it in the panorama; opened the original.');
      }
      return;
    }
    status('Loading image…');
    await enterStreetView(map, pic);
    revealStreetUI(pic);
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
  const editMain = document.getElementById('edit-main');
  editMain.disabled = true;
  editMain.title = 'Enter a 360° panorama first — Adjust fixes its orientation and position in your browser only';
  setEditModeUI(false); // closes the drawer + edit mode together (#111)
  // Exiting restored every coverage layer — reapply the legend's toggles so a
  // source the user hid stays hidden (#112).
  for (const [id, on] of sourceShown) if (!on) setSourceVisible(map, id, false);
  // Back to the 50/50 default for the next entry (#101) — streetview.js resets
  // its remembered blend on exit to match.
  blendSlider.value = String(STREET_DEFAULT_BLEND * 100);
  status(browsePrompt());
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

// Local corrections drawer (#98/#106/#111): MapMax is READ-oriented — the
// gestures fix a panorama's rendering in this browser only; nothing is ever
// written to any server (the write-back stack lives in maplibre-gl-panoramax
// for apps that want it).
const posePanel = document.getElementById('pose-panel');
const poseStatus = document.getElementById('pose-status');
const POSE_STATUS_DEFAULT = poseStatus.textContent;
// The gestures ARE the controls (#106); this read-out just mirrors them.
// Yaw is shown in ±180 around the GPS direction; storage uses [0,360).
const poseRotVal = document.getElementById('pose-rot-val');
const yawToSigned = (yaw) => (yaw > 180 ? yaw - 360 : yaw);

function syncPosePanel() {
  const pose = getCurrentPose();
  if (!pose || posePanel.hidden) return;
  poseRotVal.textContent =
    `Pitch ${pose.pitch.toFixed(1)}° · Roll ${pose.roll.toFixed(1)}° · Yaw ${yawToSigned(pose.yaw).toFixed(0)}°`;
  drawAutoPreview(); // any yaw change re-rolls the photo band (#142)
}
onPictureChanged(() => syncPosePanel());

// --- Auto-fix orientation (#142) --------------------------------------------
// Unroll the vector world and the panorama over the SAME 360° of azimuth: a
// yaw error is then just a horizontal offset between the two bands, which a
// circular correlation reads off (autoyaw.js). Everything stays local (#111).
const autoBtn = document.getElementById('pose-auto');
const autoPreview = document.getElementById('auto-preview');
let autoStrips = null; // created on demand (#142) — see ensureStrips()
const autoVerdict = document.getElementById('auto-verdict');
const autoAxes = document.getElementById('auto-axes');
const autoApply = document.getElementById('auto-apply');
const autoSkip = document.getElementById('auto-skip');
const norm360 = (d) => ((d % 360) + 360) % 360;
// The world azimuth the image centre currently claims to face.
const currentPanoYaw = () => norm360((currentPic?.heading || 0) + (getCurrentPose()?.yaw || 0));
let autoScan = null; // { world, photo, baseYaw, proposal } — one stand-point

// Redraw both bands for the CURRENT pose: the photo band is rolled by however
// much the yaw moved since the scan, so every correction (auto, ring, flip)
// shows up as the bands sliding into — or out of — alignment.
// The strips canvas exists only while the preview is open: an idle canvas in
// the overlay was enough to upset rasterization on the affected GPU (#100).
function ensureStrips() {
  if (autoStrips) return autoStrips;
  autoStrips = document.createElement('canvas');
  autoStrips.id = 'auto-strips';
  autoStrips.width = 180;
  autoStrips.height = 104;
  autoPreview.prepend(autoStrips);
  return autoStrips;
}

function removeStrips() {
  autoStrips?.remove();
  autoStrips = null;
}

function drawAutoPreview() {
  if (!autoScan || autoPreview.hidden) return;
  ensureStrips();
  const ctx = autoStrips.getContext('2d');
  ctx.clearRect(0, 0, autoStrips.width, autoStrips.height);
  ctx.putImageData(autoScan.world, 0, 0);
  // Regenerated under the FULL current pose (#142): yaw rolls it horizontally,
  // pitch/roll displace it per column — so the axes not yet checked are judged
  // against the photo as it is now, not as it was captured.
  const pose = getCurrentPose() || { pitch: 0, roll: 0 };
  ctx.putImageData(
    poseStrip(autoScan.photo, {
      dYawDeg: autoScan.baseYaw - currentPanoYaw(),
      pitchDeg: pose.pitch,
      rollDeg: pose.roll,
      centreAz: currentPanoYaw(),
      bandDeg: BAND_DEG,
    }),
    0,
    autoStrips.height - autoScan.photo.height
  );
}

async function runAutoFix() {
  const ps = _photosphere();
  const url = currentPic && originalImageUrl(currentPic);
  if (!ps || !url) return;
  autoBtn.disabled = true;
  autoPreview.hidden = true;
  removeStrips();
  try {
    poseStatus.textContent = 'Scanning the vector world — the view spins once. Then: Yaw → Pitch → Roll.';
    const world = await scanWorldStrip(map, ps, {
      setBlend,
      blendAfter: sliderToBlend(blendSlider.value),
      onProgress: (p) => { poseStatus.textContent = `Scanning the vector world… ${Math.round(p * 100)}%`; },
    });
    const baseYaw = currentPanoYaw();
    const photo = await photoStrip(url, baseYaw);
    const wp = stripProfiles(world);
    const pp = stripProfiles(photo);
    const proposal = proposeYawDelta(pp, wp);
    // With the yaw aligned, the vertical gap between the two skylines is a
    // tilt: pitch·cos(a) + roll·sin(a) around the image centre (#142).
    const n = wp.skyline.length;
    const centre = baseYaw + (isConfident(proposal) ? proposal.deltaDeg : 0);
    const diff = new Float32Array(n);
    const relAz = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const pj = (((j - proposal.shift) % n) + n) % n;
      diff[j] = (pp.skyline[pj] - wp.skyline[j]) * BAND_DEG;
      relAz[j] = (((((j * 360) / n - centre) % 360) + 540) % 360) - 180;
    }
    const tilt = fitTilt(diff, relAz);
    autoScan = { world, photo, baseYaw, proposal, tilt };
    autoPreview.hidden = false;
    drawAutoPreview();
    buildAutoSteps(proposal, tilt);
    poseStatus.textContent = POSE_STATUS_DEFAULT;
  } catch (err) {
    console.warn('auto-fix scan failed', err);
    poseStatus.textContent = `Scan failed: ${err.message || 'the panorama could not be read'}.`;
  } finally {
    autoBtn.disabled = false;
  }
}

// One axis at a time (#142): the scan proposes yaw, then pitch, then roll —
// the order they matter in, so a correction is never a three-knob guess. Every
// outcome is reported: what was applied, what was skipped, and — the case that
// must never look like success — that nothing was changed at all.
let autoSteps = [];
let autoStep = 0;
let autoApplied = [];
let autoSkipped = [];
let autoIntro = '';

function buildAutoSteps(proposal, tilt) {
  const pct = Number.isFinite(proposal.score) ? `${Math.round(proposal.score * 100)}%` : 'n/a';
  const deg = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
  autoSteps = [];
  autoApplied = [];
  autoSkipped = [];
  autoStep = 0;
  if (isConfident(proposal) && Math.abs(proposal.deltaDeg) >= 1) {
    autoSteps.push({
      axis: 'Yaw',
      label: `Yaw ${deg(proposal.deltaDeg)}`,
      hint: `turn the photo ${deg(proposal.deltaDeg)} (${proposal.method} match ${pct})`,
      apply: () => setCurrentPose({ yaw: getCurrentPose().yaw + proposal.deltaDeg }),
    });
  }
  if (tiltIsUsable(tilt)) {
    if (Math.abs(tilt.pitchDeg) >= 0.5) {
      autoSteps.push({
        axis: 'Pitch',
        label: `Pitch ${deg(tilt.pitchDeg)}`,
        hint: `tip it ${tilt.pitchDeg >= 0 ? 'up' : 'down'} to ${deg(tilt.pitchDeg)} (skyline fit ±${tilt.rms.toFixed(1)}°)`,
        apply: () => setCurrentPose({ pitch: tilt.pitchDeg }),
      });
    }
    if (Math.abs(tilt.rollDeg) >= 0.5) {
      autoSteps.push({
        axis: 'Roll',
        label: `Roll ${deg(tilt.rollDeg)}`,
        hint: `let it fall ${tilt.rollDeg >= 0 ? 'right' : 'left'} to ${deg(tilt.rollDeg)} (skyline fit ±${tilt.rms.toFixed(1)}°)`,
        apply: () => setCurrentPose({ roll: tilt.rollDeg }),
      });
    }
  }
  // Why there is nothing to do, when there is nothing to do.
  autoIntro = autoSteps.length
    ? ''
    : isConfident(proposal)
      ? `Already aligned — the photo matches the vector world to within a degree (${proposal.method} match ${pct}). Nothing to fix.`
      : `No confident match (${proposal.method} ${pct}) — too little shared structure here (open sky, trees, night). The photo is unchanged; try another picture of the sequence, or align by eye.`;
  renderAutoStep();
}

// Which axis is being checked, at a glance: a chip row (current one in the
// brand colour), a headline, and the axis named on the buttons themselves —
// "Apply Yaw −2.0°" leaves no doubt about what is about to change.
function renderAxisChips() {
  autoAxes.replaceChildren();
  for (const axis of ['Yaw', 'Pitch', 'Roll']) {
    const i = autoSteps.findIndex((st) => st.axis === axis);
    const chip = document.createElement('span');
    chip.className = 'axis-chip';
    let mark = '';
    if (i === -1) { chip.classList.add('axis-none'); mark = ' —'; }
    else if (autoApplied.some((l) => l.startsWith(axis))) { chip.classList.add('axis-done'); mark = ' ✔'; }
    else if (autoSkipped.includes(axis)) { chip.classList.add('axis-skipped'); mark = ' ✕'; }
    else if (i === autoStep) chip.classList.add('axis-current');
    chip.textContent = axis + mark;
    autoAxes.append(chip);
  }
}

function setVerdict(headline, body) {
  autoVerdict.replaceChildren();
  if (headline) {
    const h = document.createElement('div');
    h.className = 'auto-head';
    h.textContent = headline;
    autoVerdict.append(h);
  }
  const b = document.createElement('div');
  b.textContent = body;
  autoVerdict.append(b);
}

function renderAutoStep() {
  const step = autoSteps[autoStep];
  renderAxisChips();
  const done = autoApplied.length ? `Fixed: ${autoApplied.join(' · ')}. ` : '';
  const skipped = autoSkipped.length ? `Skipped: ${autoSkipped.join(', ')}. ` : '';
  if (step) {
    setVerdict(
      `▶ ${step.axis} — step ${autoStep + 1} of ${autoSteps.length}`,
      `${step.hint}. ${done}${skipped}Top band: vector world · bottom band: photo.`
    );
    autoApply.textContent = `Apply ${step.label}`;
    autoSkip.textContent = `Skip ${step.axis}`;
    autoApply.disabled = false;
    autoSkip.disabled = false;
    return;
  }
  autoApply.textContent = 'Apply';
  autoSkip.textContent = 'Skip';
  autoApply.disabled = true;
  autoSkip.disabled = true;
  if (!autoSteps.length) {
    setVerdict('Nothing to change', `${autoIntro} Top band: vector world · bottom band: photo.`);
    return;
  }
  if (autoApplied.length) {
    setVerdict('Done', `${done}${skipped}The bands should line up now. Fine-tune with the ring if needed.`);
  } else {
    setVerdict('Nothing changed', `Every suggestion was skipped (${autoSkipped.join(', ')}). The photo is as it was.`);
  }
}

autoBtn.addEventListener('click', runAutoFix);
autoApply.addEventListener('click', () => {
  const step = autoSteps[autoStep];
  if (!step) return;
  step.apply();
  autoApplied.push(step.label);
  autoStep++;
  syncPosePanel(); // redraws the bands at the new pose
  syncRing();
  renderAutoStep();
});
autoSkip.addEventListener('click', () => {
  const step = autoSteps[autoStep];
  if (!step) return;
  autoSkipped.push(step.axis);
  autoStep++;
  renderAutoStep();
});
document.getElementById('auto-dismiss').addEventListener('click', () => { autoPreview.hidden = true; removeStrips(); });
// A different picture means a different stand-point: the scan no longer applies.
onPictureChanged(() => { autoScan = null; autoPreview.hidden = true; removeStrips(); });

document.getElementById('pose-reset').addEventListener('click', () => {
  setCurrentPose({ pitch: 0, roll: 0, yaw: 0 });
  resetCurrentPosition(); // #107: back to the GPS position and default eye height
  syncPosePanel();
  syncRing();
  syncPosVal();
  syncElev();
  poseStatus.textContent = 'Pose and position reset to the picture metadata.';
});

// Pose edit mode (#106/#111): entered via the header's Edit button; the panel
// is its tool drawer. Drag rotates the photo (yaw/pitch), the ring rolls it.
const editMainBtn = document.getElementById('edit-main');
const poseRing = document.getElementById('pose-ring');
const poseRingHandle = document.getElementById('pose-ring-handle');

// The handle orbits by rotating the (visually symmetric) ring container.
function syncRing() {
  if (poseRing.hidden) return;
  poseRing.style.transform = `rotate(${getCurrentPose()?.roll || 0}deg)`;
}

// Translation read-out (#107): metre offsets east/north of the current pano
// (ΔH has its own read-out under the elevation scale).
const posVal = document.getElementById('pose-pos-val');
function syncPosVal() {
  const o = getCurrentPositionOffset();
  if (o) posVal.textContent = `ΔE ${o.e.toFixed(1)} · ΔN ${o.n.toFixed(1)} m`;
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

// Compass nudge pad (#107): fixed-resolution moves — the drags felt too
// sensitive for fine placement. 30 cm per click, 1 m with ⇧ held.
document.getElementById('pose-pad').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const step = e.shiftKey ? 1 : 0.3;
  nudgeCurrentPosition({ eastM: Number(btn.dataset.e) * step, northM: Number(btn.dataset.n) * step });
  syncPosVal();
});

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
  editMainBtn.classList.toggle('active', actual);
  // The panel is the edit-mode tool drawer (#111): one state, one toggle.
  posePanel.hidden = !actual;
  poseRing.hidden = !actual;
  poseElev.hidden = !actual;
  minimapEl.classList.toggle('minimap-editable', actual);
  if (actual) {
    syncPosePanel();
    syncRing();
    syncElev();
    syncPosVal();
    poseStatus.textContent = 'Edit mode — rotate: drag the photo (ring = horizon, flip = 180°). Move: arrows/scale on the right, ⇧-drag the ground, or drag the minimap. Esc leaves edit mode.';
  }
  return actual;
}

editMainBtn.addEventListener('click', () => {
  setEditModeUI(!isPoseEditMode());
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
