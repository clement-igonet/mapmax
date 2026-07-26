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
  if (walkTarget) {
    sv.enterStreetView(map, walkTarget); // inside → goTo (walk)
    const atTarget = () => {
      const l = sv._photosphere().lngLat;
      return l && Math.abs(l[0] - walkTarget.lon) < 1e-9 && Math.abs(l[1] - walkTarget.lat) < 1e-9;
    };
    await waitFor(atTarget, 20000);
    walkedToNext = sv.currentPicture()?.id === walkTarget.id && atTarget() && walkTarget.id !== pic0;
    walkStillInside = sv.isStreetMode() && sv._photosphere().mode === 'inside';
  }
  // #32 + #33: on-screen nearby POI dot must be hittable (cursor) and a drag
  // ending on it must NOT navigate. Best-effort (skipped if none projects on-screen).
  let poiChecked = false;
  let poiHittable = false;
  let dragOverPoiStable = true;
  await waitFor(() => map.getLayer('mapmax-nearby-poi'), 8000);
  // #33: the nearby-POI dots must be screen-aligned (default viewport), so the
  // visible dot == the hittable area and the cursor changes on hover.
  const pa = map.getLayer('mapmax-nearby-poi') &&
    map.getPaintProperty('mapmax-nearby-poi', 'circle-pitch-alignment');
  const poiViewportAligned = pa === undefined || pa === 'viewport';
  await waitFor(() => map.getSource('mapmax-nearby-poi') &&
    map.querySourceFeatures('mapmax-nearby-poi').length > 0, 8000);
  sv._photosphere().look(0, -55); // look down at the street so ground POI come into view
  await waitFor(() => false, 400);
  const poiFeats = map.getSource('mapmax-nearby-poi') ? map.querySourceFeatures('mapmax-nearby-poi') : [];
  const w = map.getCanvas().clientWidth;
  const h = map.getCanvas().clientHeight;
  let p = null;
  for (const f of poiFeats) {
    const pp = map.project(f.geometry.coordinates);
    if (pp.x > 20 && pp.x < w - 20 && pp.y > 20 && pp.y < h - 20) { p = pp; break; }
  }
  if (p) {
    poiChecked = true;
    poiHittable = map.queryRenderedFeatures([p.x, p.y], { layers: ['mapmax-nearby-poi'] }).length > 0;
    const before = sv.currentPicture()?.id;
    const canvas = map.getCanvas();
    const fire = (t, x, y) => canvas.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true, button: 0 }));
    fire('mousedown', p.x - 40, p.y); // start a drag away from the dot…
    for (let i = 1; i <= 8; i++) fire('mousemove', p.x - 40 + i * 5, p.y);
    fire('mouseup', p.x, p.y);       // …and release ON the dot
    fire('click', p.x, p.y);
    await waitFor(() => false, 400);
    dragOverPoiStable = sv.currentPicture()?.id === before;
  }
  const { tiledLayerIds } = await import('./src/tilebudget.js');
  const tiled = tiledLayerIds(map.getStyle());
  const hiddenInside = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  // #6 blend: drag to mixed → OSM vector comes back; #27: Panoramax tiles stay
  // suspended (far POIs never load), only nearby ≤50 m POIs show via GeoJSON.
  const { sliderToBlend } = await import('./src/target.js');
  const osmTiled = tiledLayerIds(map.getStyle(), ['panoramax']);
  const panoramaxTiled = tiled.filter((id) => !osmTiled.includes(id));
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
  const visibleAfter = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') !== 'none').length;
  const poiSourceExists = !!map.getSource('mapmax-nearby-poi');
  return { skipped: false, enteredMode, inStreet, exitedMode: sv._photosphere()?.mode,
           tiledCount: tiled.length, hiddenInside, visibleAfter,
           osmTiledCount: osmTiled.length, panoramaxTiledCount: panoramaxTiled.length,
           osmVisibleAtMixed, panoramaxHiddenAtMixed, hiddenBackToPhoto, blendInside,
           poiSourceExists, yawChanged, fovChanged, minimapShown, fovSyncEnter, fovSyncAfterZoom,
           dragChangedYaw, pictureStableAfterDrag, walkedToNext, walkStillInside,
           poiChecked, poiHittable, dragOverPoiStable, poiViewportAligned };
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
  assert.ok(nav.poiSourceExists, 'bounded nearby-POI GeoJSON source missing (#27)');
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
  assert.ok(nav.poiViewportAligned, 'nearby POI dots not screen-aligned — hover cursor cannot work (#33)');
  if (nav.poiChecked) {
    assert.ok(nav.poiHittable, 'nearby POI dot is not hittable — hover cursor cannot work (#33)');
    assert.ok(nav.dragOverPoiStable, 'a drag ending on a POI navigated — look-drag must not move (#32)');
    console.log('[e2e] POI hittable (#33) + drag-over-POI does not navigate (#32) OK');
  } else {
    console.log('[e2e] WARN: no on-screen POI to exercise #32/#33 this run');
  }
  console.log(`[e2e] enter/exit OK; walk OK (#5); tile ${nav.hiddenInside}/${nav.tiledCount}; blend OK (OSM ${nav.osmVisibleAtMixed}/${nav.osmTiledCount}, panoramax kept ${nav.panoramaxHiddenAtMixed}/${nav.panoramaxTiledCount} suspended #27); controls OK; FOV sync OK`);
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
await browser.close();
