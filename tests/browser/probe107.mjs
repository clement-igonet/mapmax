// Scratch probe for the #107 branch instability: capture page/console errors
// around enter + drags. NOT part of the suite.
import { chromium } from 'playwright';

const url = process.env.TARGET_URL || 'http://web/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

for (let round = 1; round <= 3; round++) {
  const out = await page.evaluate(async () => {
    const { getSequence } = await import('./src/panoramax.js');
    const sv = await import('./src/streetview.js');
    const { map } = await import('./src/main.js');
    const seq = await getSequence('a5dc43dc-d62e-457b-ad15-822bd7ced0db', 30);
    const pano = seq.find((p) => p.type === 'equirectangular') || seq[0];
    let enterError = null;
    try { await sv.enterStreetView(map, pano); } catch (e) { enterError = String(e); }
    const waitFor = (pred, ms) => new Promise((res) => {
      const t0 = performance.now();
      const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
      tick();
    });
    await waitFor(() => sv._photosphere()?.mode === 'inside', 15000);
    const ps = sv._photosphere();
    if (!ps) return { enterError, mode: 'NULL' };
    const yaw0 = ps.yaw;
    const c = map.getContainer();
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: 640, clientY: 400, bubbles: true }));
    for (let i = 1; i <= 6; i++) window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640 + i * 12, clientY: 400, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 712, clientY: 400, bubbles: true }));
    const dragOk = ps.yaw !== yaw0;
    sv.exitStreetView();
    await waitFor(() => !sv.isStreetMode(), 8000);
    return { enterError, mode: ps.mode, dragOk, editOn: sv.isPoseEditMode() };
  });
  console.log(`round ${round}:`, JSON.stringify(out));
}
await browser.close();
