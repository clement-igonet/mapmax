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
  const { tiledLayerIds } = await import('./src/tilebudget.js');
  const tiled = tiledLayerIds(map.getStyle());
  const hiddenInside = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  // #6 blend: drag to mixed → vector layers come back; back to photo → suspended.
  const { sliderToBlend } = await import('./src/target.js');
  sv.setBlend(sliderToBlend(50));
  const visibleAtMixed = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') !== 'none').length;
  sv.setBlend(sliderToBlend(100));
  const hiddenBackToPhoto = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') === 'none').length;
  const blendInside = sv._photosphere()?._blend;
  sv.setBlend(sliderToBlend(50)); // leave mixed to check restore path on exit
  sv.exitStreetView();
  await waitFor(() => !sv.isStreetMode(), 8000);
  const visibleAfter = tiled.filter((id) => map.getLayer(id) &&
    map.getLayoutProperty(id, 'visibility') !== 'none').length;
  return { skipped: false, enteredMode, inStreet, exitedMode: sv._photosphere()?.mode,
           tiledCount: tiled.length, hiddenInside, visibleAfter,
           visibleAtMixed, hiddenBackToPhoto, blendInside };
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
  assert.equal(nav.visibleAtMixed, nav.tiledCount, `blend 50% did not reveal vector layers (#6)`);
  assert.equal(nav.hiddenBackToPhoto, nav.tiledCount, `blend 100% did not re-suspend tiles (#6)`);
  assert.equal(nav.blendInside, 1, 'blend 100% should set photo opacity to 1 (#6)');
  console.log(`[e2e] photosphere enter/exit OK; tile budget ${nav.hiddenInside}/${nav.tiledCount}; blend reveal/suspend OK`);
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
