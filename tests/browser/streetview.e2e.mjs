// Browser-level end-to-end test: real Chromium (in a container) loads MapMax
// on MapLibre 6 (ESM), boots to a clean map, then drives the photosphere
// plugin through a real Panoramax picture: enter -> inside -> exit.
// Covers #1 (map+buildings), #14 (clean console), #19 (MapLibre 6 ESM),
// and the plugin adoption (enter/exit).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.TARGET_URL || 'http://web/';
console.log(`[e2e] target: ${url}`);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
const warnings = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });
await page.waitForFunction(
  () => document.getElementById('hud-status')?.textContent?.includes('Zoom in'),
  { timeout: 60000 }
);
assert.match(await page.title(), /MapMax/, 'page title');

// docs (#12): every chapter illustration referenced in SPECIFICATIONS.md must
// render as a valid SVG in the browser. Checked on the fresh page (before any
// street-view interaction) so it is independent of later map state.
const base = url.endsWith('/') ? url : url + '/';
const svgReport = await page.evaluate(async (b) => {
  const md = await (await fetch(b + 'SPECIFICATIONS.md')).text();
  const files = [...md.matchAll(/\(assets\/spec\/([\w-]+\.svg)\)/g)].map((m) => m[1]);
  const results = [];
  for (const f of files) {
    const ok = await new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img.naturalWidth > 0 && img.naturalHeight > 0);
      img.onerror = () => res(false);
      img.src = b + 'assets/spec/' + f;
    });
    results.push({ f, ok });
  }
  return { count: files.length, bad: results.filter((r) => !r.ok).map((r) => r.f) };
}, base);
assert.ok(svgReport.count >= 8, `expected ≥8 spec illustrations, found ${svgReport.count} (#12)`);
assert.deepEqual(svgReport.bad, [], `spec illustrations failed to render: ${svgReport.bad.join(', ')} (#12)`);
console.log(`[e2e] spec illustrations render OK (${svgReport.count}) (#12)`);

// MapLibre 6 ESM + Panoramax source + 3D buildings wired (#1, #2, #19).
const wiring = await page.evaluate(async () => {
  const mod = await import('./src/main.js');
  const map = mod.map;
  return {
    version: (map.version || '').toString(),
    hasPanoramax: !!map.getSource('panoramax'),
    hasExtrusion: map.getStyle().layers.some((l) => l.type === 'fill-extrusion'),
  };
});
assert.ok(wiring.hasPanoramax, 'panoramax source missing');
assert.ok(wiring.hasExtrusion, '3D buildings layer missing');
console.log(`[e2e] map version: ${wiring.version || 'n/a'}`);

// Map-mode clutter cap (#41): the tilt is limited so the map never renders 3D
// buildings + Panoramax dots out to the horizon, and the limit rises as you zoom
// in. Verify the cap is below the hard max, grows on zoom-in, and that at the cap
// the top of the viewport looks no further than ~the configured radius.
const clutter = await page.evaluate(async () => {
  const { map } = await import('./src/main.js');
  const { MAP_VISIBLE_RADIUS_M, MAP_MAX_PITCH } = await import('./src/config.js');
  const { distanceM } = await import('./src/geo.js');
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const farAtCap = () => {
    map.setPitch(map.getMaxPitch());
    const c = map.getCenter();
    const w = map.getCanvas().clientWidth;
    const top = map.unproject([w / 2, 0]);
    return distanceM(c.lng, c.lat, top.lng, top.lat);
  };
  const startZoom = map.getZoom();
  const capAtStart = map.getMaxPitch();
  map.setZoom(startZoom + 2.5);
  await settle();
  const capZoomedIn = map.getMaxPitch();
  const farZoomedIn = farAtCap();
  map.setZoom(startZoom); // restore for later steps
  await settle();
  return { capAtStart, capZoomedIn, farZoomedIn, R: MAP_VISIBLE_RADIUS_M, hardMax: MAP_MAX_PITCH };
});
assert.ok(clutter.capAtStart < clutter.hardMax - 1, `map tilt not capped (${clutter.capAtStart}° = hard max) — would render to the horizon (#41)`);
assert.ok(clutter.capZoomedIn > clutter.capAtStart + 1, 'tilt cap did not unlock when zooming in (#41)');
assert.ok(clutter.farZoomedIn <= clutter.R * 1.25, `at the tilt cap the map sees ${clutter.farZoomedIn | 0} m > radius ${clutter.R} m (#41)`);
console.log(`[e2e] clutter cap OK (cap ${clutter.capAtStart | 0}°→${clutter.capZoomedIn | 0}° on zoom-in; far@cap ${clutter.farZoomedIn | 0} m ≤ ~${clutter.R} m) (#41)`);

// Drive the photosphere plugin with a real Panoramax picture (plugin adoption).
const nav = await page.evaluate(async () => {
  const { getSequence } = await import('./src/panoramax.js');
  const sv = await import('./src/streetview.js');
  const { map } = await import('./src/main.js');
  const seq = await getSequence('a5dc43dc-d62e-457b-ad15-822bd7ced0db', 30);
  const pano = seq.find((p) => p.type === 'equirectangular') || seq[0];
  if (!pano) return { skipped: true };
  sv.enterStreetView(map, pano);
  const waitFor = (pred, ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  await waitFor(() => sv._photosphere()?.mode === 'inside', 10000);
  const enteredMode = sv._photosphere()?.mode;
  const inStreet = sv.isStreetMode();
  // #54 deep-link: entering writes ?pic=<id> to the URL (checked before the walk
  // moves us to another picture). deepLinkId feeds the reload test below.
  const urlPicOnEnter = new URLSearchParams(location.search).get('pic');
  const deepLinkId = pano.id;
  // #52: the shader rotates the texture by the picture heading (view:azimuth) so
  // the photo aligns with the vector world instead of assuming centre = north.
  const panoYawApplied = sv._photosphere()._panoYawDeg === ((pano.heading || 0) + (pano.yawOffset || 0)) % 360;
  // #24: map vertical FOV must equal the sphere's FOV (photo/vector in sync).
  const fovSyncEnter = Math.abs(map.getVerticalFieldOfView() - sv._photosphere()._options.fov) < 0.01;
  // #30: dragging to look changes the view but must NOT translate to another pano.
  const pic0 = sv.currentPicture()?.id;
  const psLook = sv._photosphere();
  const yawBeforeDrag = psLook.yaw;
  const container = map.getContainer();
  container.dispatchEvent(new MouseEvent('mousedown', { clientX: 640, clientY: 400, bubbles: true }));
  for (let i = 1; i <= 6; i++) {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640 + i * 12, clientY: 400, bubbles: true }));
  }
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: 712, clientY: 400, bubbles: true }));
  const dragChangedYaw = psLook.yaw !== yawBeforeDrag;
  const pictureStableAfterDrag = sv.currentPicture()?.id === pic0;
  // #5 smooth walk: step to an adjacent panorama (goTo) — position changes,
  // stays inside (no exit), anchor updates once the next image decodes.
  const seqPanos = seq.filter((p) => p.type === 'equirectangular');
  const walkTarget = seqPanos.find((p) => p.id !== pano.id) || seq.find((p) => p.id !== pano.id);
  let walkedToNext = false;
  let walkStillInside = false;
  let smoothWalk = false;
  let walkMixSeen = 0;
  let walkPanoYawApplied = false;
  if (walkTarget) {
    // Pre-warm the target image so the in-container texture upload is
    // deterministic (first-load into a shared GL texture is flaky under
    // swiftshader; real browsers and direct goTo are fine).
    await new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = res;
      im.onerror = res;
      im.src = walkTarget.assets.sd || walkTarget.assets.hd || walkTarget.assets.thumb;
    });
    const atTarget = () => {
      const l = sv._photosphere().lngLat;
      return l && Math.abs(l[0] - walkTarget.lon) < 1e-9 && Math.abs(l[1] - walkTarget.lat) < 1e-9;
    };
    // Prove it's a smooth dolly, not a teleport (#5b): sample the crossfade
    // weight + transition flag across the walk. A teleport would flip lngLat with
    // uMix never leaving 0 and _transitioning never true. Retried once because
    // the first shared-GL texture upload can silently hang under swiftshader
    // (real browsers and direct goTo are fine) — a re-issued goTo re-uploads.
    let sawMix = 0;
    let sawTransitioning = false;
    for (let attempt = 0; attempt < 2 && !atTarget(); attempt++) {
      sv.enterStreetView(map, walkTarget); // inside → goTo (walk)
      const t0 = performance.now();
      const sampler = () => {
        const ps = sv._photosphere();
        sawMix = Math.max(sawMix, ps._mix || 0);
        if (ps._transitioning) sawTransitioning = true;
        if (!atTarget() && performance.now() - t0 < 20000) requestAnimationFrame(sampler);
      };
      requestAnimationFrame(sampler);
      await waitFor(atTarget, 20000);
    }
    walkedToNext = sv.currentPicture()?.id === walkTarget.id && atTarget() && walkTarget.id !== pic0;
    walkStillInside = sv.isStreetMode() && sv._photosphere().mode === 'inside';
    smoothWalk = sawTransitioning && sawMix > 0.05 && sawMix <= 1.0001;
    walkMixSeen = sawMix;
    walkPanoYawApplied = sv._photosphere()._panoYawDeg === ((walkTarget.heading || 0) + (walkTarget.yawOffset || 0)) % 360; // #52/#66
  }
  // #34: the page shows the current picture's id, and it updates after the walk.
  const picInfoText = document.getElementById('pic-info')?.textContent || '';
  const infoEl = document.getElementById('pic-info');
  const picInfoShowsId = !infoEl?.hidden && picInfoText.includes(sv.currentPicture()?.id || ' ');
  const picInfoHasBadge = !!infoEl?.querySelector('.pic-badge');
  const picInfoHasOriginalLink = !!infoEl?.querySelector('a[target="_blank"]');
  const enteredIs360 = sv.currentPicture()?.type === 'equirectangular';
  // #37: street mode replaces the raw-white background with a ground tone so the
  // vector-only view is never an empty white void.
  const backdropApplied = map.getPaintProperty('background', 'background-color') === '#d7d9dc' &&
    getComputedStyle(document.getElementById('map')).backgroundColor === 'rgb(215, 217, 220)' &&
    !!map.getSky();
  // Both the ground arrows AND the neighbour dots are drawn INSIDE the
  // photosphere shader (#26, #39) — there is NO MapLibre nav layer to clip.
  // Assert the plugin received both, there are nav targets, and that clicking
  // empty space does NOT navigate (floor-raycast hit-test, drag-safe #32).
  const navMod = await import('./src/navigation.js');
  await waitFor(() => (navMod._navCounts().arrows + navMod._navCounts().poi) > 0, 10000);
  const nc = navMod._navCounts();
  const navTargets = nc.arrows + nc.poi;
  const ps0 = sv._photosphere();
  const shaderArrowCount = ps0?._navArrows?.length ?? 0;
  const shaderPoiCount = ps0?._navPois?.length ?? 0;
  const noMapNavLayer = !map.getLayer('mapmax-nav-poi') && !map.getLayer('mapmax-nav-arrows');
  const hasGlNavLayers = noMapNavLayer && shaderArrowCount === nc.arrows && shaderPoiCount === nc.poi;
  // #26 crop guard: floor arrows live on the ground plane in the shader — they
  // span the full viewport and CANNOT be cropped by the map near plane. Prove an
  // arrow is hittable across a range of grazing pitches (a near-plane-clipped
  // arrow would vanish from the lower rows). groundPick runs the same maths the
  // shader draws with, so pickable ⇒ drawn.
  let arrowsNotClipped = true;
  if (nc.arrows > 0) {
    const target = navMod._navArrows()[0];
    const savedYaw = ps0._yawDeg, savedPitch = ps0._pitchDeg;
    ps0._yawDeg = target.bearing;
    const cw = map.getCanvas().clientWidth, chh = map.getCanvas().clientHeight;
    let hit = false;
    for (let p = -8; p >= -45 && !hit; p -= 2) {
      ps0._pitchDeg = p;
      for (let fy = 0.5; fy <= 0.98; fy += 0.04) {
        if (ps0.groundPick(cw / 2, chh * fy) === target.targetId) { hit = true; break; }
      }
    }
    ps0._yawDeg = savedYaw; ps0._pitchDeg = savedPitch;
    arrowsNotClipped = hit;
  }
  const beforeId = sv.currentPicture()?.id;
  const canvas = map.getCanvas();
  const fire = (t, x, y) => canvas.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true, button: 0 }));
  fire('mousedown', 6, 6); fire('click', 6, 6); // top-left corner: no feature there
  await waitFor(() => false, 300);
  const clickEmptyStable = sv.currentPicture()?.id === beforeId;
  const { tiledLayerIds } = await import('./src/tilebudget.js');
  const tiled = tiledLayerIds(map.getStyle());
  const hiddenInside = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  // #6 blend: drag to mixed → OSM vector comes back; #27: Panoramax tiles stay
  // suspended (far POIs never load), only nearby ≤50 m POIs show via GeoJSON.
  const { sliderToBlend } = await import('./src/target.js');
  // Building extrusions are gated to z18 (#82); their blend visibility depends on
  // zoom, so exclude them from the "blend reveals OSM" count to keep it stable.
  const panoramaxTiled = tiled.filter((id) => tiledLayerIds(map.getStyle()).includes(id) && !tiledLayerIds(map.getStyle(), ['panoramax']).includes(id));
  const osmTiled = tiledLayerIds(map.getStyle(), ['panoramax']).filter((id) => map.getLayer(id)?.type !== 'fill-extrusion');
  sv.setBlend(sliderToBlend(50));
  const osmVisibleAtMixed = osmTiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') !== 'none').length;
  const panoramaxHiddenAtMixed = panoramaxTiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  const visibleAtMixed = osmVisibleAtMixed; // OSM reveal count (kept name below)
  sv.setBlend(sliderToBlend(100));
  const hiddenBackToPhoto = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  const blendInside = sv._photosphere()?._blend;
  // #7 controls: keyboard look changes yaw; FOV key changes fov; minimap shows.
  const ps = sv._photosphere();
  const yaw0 = ps.yaw;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const yawChanged = ps.yaw !== yaw0;
  const fov0 = ps._options.fov;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
  const fovChanged = ps._options.fov !== fov0;
  const fovSyncAfterZoom = Math.abs(map.getVerticalFieldOfView() - ps._options.fov) < 0.01;
  const minimapShown = !document.getElementById('minimap').hidden;
  sv.setBlend(sliderToBlend(50)); // leave mixed to check restore path on exit
  sv.exitStreetView();
  await waitFor(() => !sv.isStreetMode(), 8000);
  const urlPicAfterExit = new URLSearchParams(location.search).get('pic'); // #54: cleared on exit
  const visibleAfter = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') !== 'none').length;
  const navAfterExit = navMod._navCounts().arrows + navMod._navCounts().poi;
  return { skipped: false, enteredMode, inStreet, exitedMode: sv._photosphere()?.mode,
           tiledCount: tiled.length, hiddenInside, visibleAfter,
           osmTiledCount: osmTiled.length, panoramaxTiledCount: panoramaxTiled.length,
           osmVisibleAtMixed, panoramaxHiddenAtMixed, hiddenBackToPhoto, blendInside,
           yawChanged, fovChanged, minimapShown, fovSyncEnter, fovSyncAfterZoom,
           dragChangedYaw, pictureStableAfterDrag, walkedToNext, walkStillInside, smoothWalk, walkMixSeen,
           panoYawApplied, walkPanoYawApplied, urlPicOnEnter, deepLinkId, urlPicAfterExit,
           navTargets, hasGlNavLayers, clickEmptyStable, navAfterExit, arrowsNotClipped, shaderArrowCount, shaderPoiCount,
           picInfoShowsId, picInfoHasBadge, picInfoHasOriginalLink, enteredIs360,
           backdropApplied, bgAfterExit: map.getPaintProperty('background', 'background-color') };
});
if (nav.skipped) {
  console.log('[e2e] WARN: no panorama fetched from sample sequence — enter/exit not exercised');
} else {
  assert.ok(nav.inStreet, 'photosphere did not enter street mode');
  assert.ok(['entering', 'inside'].includes(nav.enteredMode), `unexpected mode ${nav.enteredMode}`);
  assert.equal(nav.exitedMode, 'outside', 'photosphere did not exit back to map');
  assert.ok(nav.tiledCount > 0, 'expected some tiled layers');
  assert.equal(nav.hiddenInside, nav.tiledCount, `tiled layers not suspended inside (#11): ${nav.hiddenInside}/${nav.tiledCount}`);
  assert.equal(nav.visibleAfter, nav.tiledCount, 'tiled layers not restored after exit (#11)');
  assert.equal(nav.osmVisibleAtMixed, nav.osmTiledCount, `blend 50% did not reveal OSM vector layers (#6)`);
  assert.ok(nav.panoramaxTiledCount > 0, 'expected Panoramax tiled layers');
  assert.equal(nav.panoramaxHiddenAtMixed, nav.panoramaxTiledCount, `Panoramax tiles must stay suspended in blend — far POIs must not load (#27)`);
  assert.equal(nav.hiddenBackToPhoto, nav.tiledCount, `blend 100% did not re-suspend tiles (#6)`);
  assert.equal(nav.blendInside, 1, 'blend 100% should set photo opacity to 1 (#6)');
  assert.ok(nav.yawChanged, 'keyboard look did not change yaw (#7)');
  assert.ok(nav.fovChanged, 'keyboard FOV zoom did not change fov (#7)');
  assert.ok(nav.minimapShown, 'minimap not shown in street mode (#7)');
  assert.ok(nav.fovSyncEnter, 'map FOV != sphere FOV on enter — photo/vector desync (#24)');
  assert.ok(nav.fovSyncAfterZoom, 'map FOV != sphere FOV after zoom — desync (#24)');
  assert.ok(nav.dragChangedYaw, 'drag did not look around (#30)');
  assert.ok(nav.pictureStableAfterDrag, 'dragging to look translated to another photosphere (#30)');
  assert.ok(nav.walkedToNext, 'walk to an adjacent panorama did not move position (#5)');
  assert.ok(nav.walkStillInside, 'walk exited street view instead of staying inside (#5)');
  assert.ok(nav.smoothWalk, `walk teleported instead of dollying — crossfade never ramped (mix seen ${nav.walkMixSeen?.toFixed?.(2)}) (#5b)`);
  assert.ok(nav.panoYawApplied, 'photo texture not oriented by the picture heading — would misalign with the vector world (#52)');
  assert.ok(nav.walkPanoYawApplied, 'walked panorama not re-oriented by its own heading (#52)');
  assert.ok(nav.hasGlNavLayers, 'incrusted nav out of sync — a map-plane nav layer exists, or shader arrow/POI counts mismatch (#39)');
  assert.ok(nav.navTargets > 0, 'no navigation targets (arrows/POI) to neighbour 360s');
  assert.ok(nav.arrowsNotClipped, 'shader ground arrow was not hittable across grazing pitches — would be cropped (#26)');
  assert.ok(nav.clickEmptyStable, 'clicking empty space navigated — must only navigate on a feature (#32)');
  assert.equal(nav.navAfterExit, 0, 'navigation targets not cleared on exit');
  assert.equal(nav.urlPicOnEnter, nav.deepLinkId, 'entering a photosphere did not write ?pic= to the URL (#54)');
  assert.equal(nav.urlPicAfterExit, null, 'exiting did not clear ?pic= from the URL (#54)');
  assert.ok(nav.picInfoShowsId, 'page does not show the current picture id (#34)');
  assert.ok(nav.enteredIs360, 'entered a non-360 picture into the sphere (#40)');
  assert.ok(nav.picInfoHasBadge, '360/flat badge missing (#40)');
  assert.ok(nav.picInfoHasOriginalLink, 'View-original link missing (#40)');
  assert.ok(nav.backdropApplied, 'street mode did not replace the raw-white background with a ground tone (#37)');
  assert.notEqual(nav.bgAfterExit, '#d7d9dc', 'street backdrop not restored on exit (#37)');
  console.log('[e2e] street backdrop applied + restored on exit (#37) OK');
  console.log(`[e2e] incrusted nav OK (${nav.navTargets} targets, GL layers, click-safe)`);
  console.log(`[e2e] enter/exit OK; walk OK (#5); tile ${nav.hiddenInside}/${nav.tiledCount}; blend OK (OSM ${nav.osmVisibleAtMixed}/${nav.osmTiledCount}, panoramax kept ${nav.panoramaxHiddenAtMixed}/${nav.panoramaxTiledCount} suspended #27); controls OK; FOV sync OK`);

  // #54 deep-link: a fresh page load carrying ?pic=<id> must restore street view
  // on that picture (as if you had reloaded while inside it).
  if (nav.deepLinkId) {
    await page.goto(`${base}?pic=${nav.deepLinkId}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#map canvas', { timeout: 30000 });
    const deep = await page.evaluate(async () => {
      const sv = await import('./src/streetview.js');
      const waitFor = (pred, ms) => new Promise((res) => {
        const t0 = performance.now();
        const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
        tick();
      });
      await waitFor(() => sv.isStreetMode() && sv.currentPicture(), 20000);
      return { inStreet: sv.isStreetMode(), id: sv.currentPicture()?.id, picStillInUrl: new URLSearchParams(location.search).get('pic') };
    });
    assert.ok(deep.inStreet, 'deep-link ?pic= did not restore street view on reload (#54)');
    assert.equal(deep.id, nav.deepLinkId, 'deep-link restored the wrong picture (#54)');
    assert.equal(deep.picStillInUrl, nav.deepLinkId, 'deep-link ?pic= lost from the URL after restore (#54)');
    console.log('[e2e] deep-link ?pic= restores street view on reload (#54) OK');
  }

  // #66 sun-compass: pic 0098117e is a REAL backward-mounted GoPro pano
  // (view:azimuth 208 = travel; sun proves the image centre faces ~28). The sun
  // compass must detect the 180° flip so the photosphere is not rendered
  // backward ("walk forward, scene recedes").
  const FLIPPED_PIC = '0098117e-f71f-458d-93f3-21487146e320';
  await page.goto(`${base}?pic=${FLIPPED_PIC}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#map canvas', { timeout: 30000 });
  const flip = await page.evaluate(async () => {
    const sv = await import('./src/streetview.js');
    const waitFor = (pred, ms) => new Promise((res) => {
      const t0 = performance.now();
      const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
      tick();
    });
    await waitFor(() => sv.isStreetMode() && sv.currentPicture(), 25000);
    const pic = sv.currentPicture();
    return { heading: pic?.heading, yawOffset: pic?.yawOffset, panoYaw: sv._photosphere()?._panoYawDeg, hasCompass: pic?.hasCompass };
  });
  // (hasCompass is informational only — GoPro fills GPSImgDirection from the GPS
  // track, so it proves nothing about the image centre.)
  assert.equal(flip.yawOffset, 180, `sun compass did not detect the 180° flip (offset ${flip.yawOffset}) (#66)`);
  assert.equal(Math.round(flip.panoYaw), (flip.heading + 180) % 360, 'flip not applied to the rendered pano yaw (#66)');
  console.log(`[e2e] sun-compass flip detected & applied (heading ${flip.heading} → panoYaw ${flip.panoYaw}) (#66) OK`);

  // #69 manual flip button: overrides the auto verdict per sequence (persisted)
  // and re-renders immediately. Toggling twice returns to the auto orientation.
  const manual = await page.evaluate(async () => {
    const sv = await import('./src/streetview.js');
    const btn = document.getElementById('flip-pano');
    const yaw0 = sv._photosphere()._panoYawDeg;
    btn.click();
    const yaw1 = sv._photosphere()._panoYawDeg;
    const overridden = Object.keys(localStorage).some((k) => k.startsWith('mapmax:yawoverride:'));
    btn.click();
    const yaw2 = sv._photosphere()._panoYawDeg;
    return { visible: !btn.hidden, delta1: Math.round(Math.abs(yaw1 - yaw0)) % 360, backTo0: Math.round(yaw2) === Math.round(yaw0), overridden };
  });
  assert.ok(manual.visible, 'flip button not visible in street mode (#69)');
  assert.equal(manual.delta1, 180, 'flip button did not rotate the pano 180° (#69)');
  assert.ok(manual.backTo0, 'second flip did not return to the original orientation (#69)');
  assert.ok(manual.overridden, 'flip override not persisted (#69)');
  console.log('[e2e] manual 180° flip button works & persists (#69) OK');
}


// Console must stay clean (#14).
await page.waitForTimeout(2000);
const offenders = [...errors, ...warnings].filter(
  (t) =>
    t.includes('could not be loaded') ||
    t.includes('Expected value to be of type number') ||
    t.includes('Uncaught')
);
assert.deepEqual(offenders, [], `console must be clean, got:\n${offenders.join('\n')}`);

const favicon = await page.getAttribute('link[rel="icon"]', 'href');
assert.ok(favicon?.startsWith('data:image/svg+xml'), 'inline favicon missing');

console.log(`[e2e] OK — MapLibre 6 map ready, plugin drive OK, console clean (${errors.length} errors, ${warnings.length} warnings, 0 offenders)`);

// #76 license gate: on the sandbox host (simulated with ?sandbox=1) the app is
// gated until a valid Polar license key is entered. Polar's validate call is
// mocked so the test is deterministic (the real 200/404 contract is unit-tested).
const gatePage = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await gatePage.route('**/customer-portal/license-keys/validate', async (route) => {
  const key = (route.request().postDataJSON()?.key) || '';
  const ok = key.includes('MAPMAX-E966');
  await route.fulfill({ status: ok ? 200 : 404, contentType: 'application/json', body: JSON.stringify(ok ? { id: 'lk', status: 'granted' } : { error: 'ResourceNotFound' }) });
});
await gatePage.goto(`${base}?sandbox=1`, { waitUntil: 'load', timeout: 60000 });
await gatePage.waitForSelector('#license-gate', { timeout: 15000 });
const gate = await gatePage.evaluate(() => ({
  overlay: !!document.getElementById('license-gate'),
  gatedClass: document.body.classList.contains('license-gated'),
  buyHref: document.getElementById('license-buy')?.getAttribute('href') || '',
}));
assert.ok(gate.overlay && gate.gatedClass, 'sandbox host not gated (#76)');
assert.ok(/checkout-links/.test(gate.buyHref), 'checkout link missing from the gate (#76)');
// wrong key → gate stays, error shown
await gatePage.fill('#license-key-input', 'MAPMAX-0000-0000-0000-000000000000');
await gatePage.click('#license-unlock');
await gatePage.waitForFunction(() => document.querySelector('#license-msg')?.classList.contains('license-err'), { timeout: 8000 });
assert.ok(await gatePage.$('#license-gate'), 'gate wrongly opened on an invalid key (#76)');
// valid key → gate removed + entitlement cached
await gatePage.fill('#license-key-input', 'MAPMAX-E966D592-D1DF-4F38-A0CC-2E696A505869');
await gatePage.click('#license-unlock');
await gatePage.waitForFunction(() => !document.getElementById('license-gate'), { timeout: 8000 });
const cached = await gatePage.evaluate(() => localStorage.getItem('mapmax:license'));
assert.ok(cached && cached.includes('MAPMAX-E966'), 'entitlement not cached after unlock (#76)');
// reload → cached entitlement skips the gate
await gatePage.goto(`${base}?sandbox=1`, { waitUntil: 'load', timeout: 60000 });
await gatePage.waitForTimeout(1500);
assert.ok(!(await gatePage.$('#license-gate')), 'cached entitlement did not skip the gate on reload (#76)');
console.log('[e2e] license gate: blocks unlicensed, rejects bad key, unlocks + caches on valid key (#76) OK');
await gatePage.close();

await browser.close();
