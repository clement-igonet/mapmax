// Scratch repro for the #104 'Connect is a nop' report: load the user's exact
// deep-link shape (?pic=…&pv=…#hash), wait for street mode, then interrogate
// the live module state and click Connect. NOT part of the e2e suite.
import { chromium } from 'playwright';

const url = (process.env.TARGET_URL || 'http://web/') +
  '?pic=8db0064d-a815-4020-81af-c7b71670bf55&pv=215_0#18/48.854672/2.349623/-145/90';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

const report = await page.evaluate(async () => {
  const sv = await import('./src/streetview.js');
  const waitFor = (pred, ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  await waitFor(() => sv.isStreetMode() && sv._photosphere()?.mode === 'inside', 30000);
  const out = { mode: sv._photosphere()?.mode, isStreet: sv.isStreetMode() };
  out.pic0 = sv.currentPicture() ? { id: sv.currentPicture().id, homeApi: sv.currentPicture().homeApi } : null;
  // Open the panel and click Connect exactly like the user.
  document.getElementById('pose-toggle').click();
  document.getElementById('pose-connect').click();
  await new Promise((r) => setTimeout(r, 1500));
  out.picAfter = sv.currentPicture() ? { id: sv.currentPicture().id, homeApi: sv.currentPicture().homeApi } : null;
  out.status = document.getElementById('pose-status').textContent;
  out.panelHidden = document.getElementById('pose-panel').hidden;
  out.toggleHidden = document.getElementById('pose-toggle').hidden;
  return out;
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
