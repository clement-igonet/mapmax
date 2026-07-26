// Browser-level end-to-end test: real Chromium (in a container) loads MapMax
// and must reach a ready, error-free map. Covers issues #1 (map + buildings
// boot), #14 (clean console: no missing images, no null-height errors) and
// smoke-checks the app wiring of #2/#3 (sources & modules load).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.TARGET_URL || 'http://web/';
console.log(`[e2e] target: ${url}`);

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
const warnings = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// The map is ready when the style loaded and our HUD says so (issue #1).
await page.waitForSelector('#map canvas', { timeout: 30000 });
await page.waitForFunction(
  () => document.getElementById('hud-status')?.textContent?.includes('Zoom in'),
  { timeout: 60000 }
);

assert.match(await page.title(), /MapMax/, 'page title');

// Panoramax source and 3D buildings are wired (issues #1, #2).
const wiring = await page.evaluate(async () => {
  const mod = await import('./src/main.js');
  const map = mod.map;
  return {
    hasPanoramax: !!map.getSource('panoramax'),
    hasExtrusion: map.getStyle().layers.some((l) => l.type === 'fill-extrusion'),
  };
});
assert.ok(wiring.hasPanoramax, 'panoramax source missing');
assert.ok(wiring.hasExtrusion, '3D buildings layer missing');

// Give the style/tiles a moment to surface any data-driven errors, then
// assert the console stayed clean (issue #14).
await page.waitForTimeout(4000);
const offenders = [...errors, ...warnings].filter(
  (t) =>
    t.includes('could not be loaded') ||
    t.includes('Expected value to be of type number') ||
    t.includes('Uncaught')
);
assert.deepEqual(offenders, [], `console must be clean, got:\n${offenders.join('\n')}`);

// Favicon reachable (issue #14) — inline data URI never 404s.
const favicon = await page.getAttribute('link[rel="icon"]', 'href');
assert.ok(favicon?.startsWith('data:image/svg+xml'), 'inline favicon missing');

console.log(`[e2e] OK — map ready, wiring present, console clean (${errors.length} errors, ${warnings.length} warnings total, 0 offenders)`);
await browser.close();
