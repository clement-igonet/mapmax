// MapMax entry point — MapLibre map (OSM ground + 3D buildings) with immersive
// Panoramax photospheres via the vendored maplibre-gl-photosphere plugin.
import * as maplibregl from 'maplibre-gl';
import { OSM_STYLE_URL, START_VIEW, MAP_MAX_PITCH, STREET_BUILDINGS_RADIUS_M, POLAR } from './config.js';
import { buildingRadiusFilter, isSandboxHost, parseRadiusOverride } from './buildings.js';
import { addPanoramaxLayers, onPictureClick, getPicture } from './panoramax.js';
import { _photosphere, enterStreetView, exitStreetView, flipCurrentPano, isStreetMode, onPictureChanged, setBlend } from './streetview.js';
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
  blendSlider.value = '100';
  status('Zoom in and click a Panoramax picture dot.');
};

// Manual 180° flip for a mis-oriented sequence (#69) — backstop when the sun
// compass can't see the sun (evening rides, narrow alleys). Persists per
// sequence and re-renders immediately.
document.getElementById('flip-pano').addEventListener('click', () => {
  const applied = flipCurrentPano();
  if (applied != null) status(`Photo rotated ${applied ? '180°' : 'back to metadata orientation'} for this sequence.`);
});
exitBtn.addEventListener('click', () => {
  if (isStreetMode()) exitStreetView();
  leaveStreetUI();
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
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

// Clip 3D buildings to a radius around the standpoint in street mode (#95). A
// SANDBOX-ONLY experiment for now (off on www), so we can tune it live: the radius
// is runtime-variable — ?buildingsRadius=<m> in the URL, or window.setBuildingsRadius(m)
// in the console; 0 disables. `center` null (map mode) restores each layer's
// original filter. The filter builder is pure and unit-tested (buildings.js).
const buildingsClipOn = isSandboxHost(location.hostname, location.search, POLAR.gatedHost);
let buildingsRadiusM = parseRadiusOverride(location.search, STREET_BUILDINGS_RADIUS_M);
let buildingsStandpoint = null;
const origBuildingFilter = new Map();
function setBuildingsRadius(center) {
  const clip = buildingsClipOn && center && buildingsRadiusM > 0;
  for (const l of map.getStyle().layers) {
    if (l.type !== 'fill-extrusion') continue;
    if (!origBuildingFilter.has(l.id)) origBuildingFilter.set(l.id, map.getFilter(l.id) ?? null);
    const orig = origBuildingFilter.get(l.id);
    try {
      map.setFilter(l.id, clip ? buildingRadiusFilter(orig, center.lng, center.lat, buildingsRadiusM) : orig);
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
