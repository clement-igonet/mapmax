// Scratch probe: does a position nudge re-derive the nav POI offsets?
import { chromium } from 'playwright';
const url = (process.env.TARGET_URL || 'http://web/') + '?pic=0098117e-f71f-458d-93f3-21487146e320';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });
const out = await page.evaluate(async () => {
  const sv = await import('./src/streetview.js');
  const waitFor = (pred, ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  await waitFor(() => sv._photosphere()?.mode === 'inside', 30000);
  await waitFor(() => (sv._photosphere()?._navPois || []).length > 0, 15000);
  const ps = sv._photosphere();
  let fired = 0;
  sv.onPositionChanged(() => fired++);
  const before = (ps._navPois || []).slice(0, 3).map((p) => ({ id: p.id.slice(0, 8), east: p.east }));
  const off1 = sv.nudgeCurrentPosition({ eastM: 0.3 });
  const after = (ps._navPois || []).slice(0, 3).map((p) => ({ id: p.id.slice(0, 8), east: p.east }));
  return { fired, off1, before, after };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
