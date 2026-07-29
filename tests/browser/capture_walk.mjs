// Capture frames DURING a forward walk to see whether the scene approaches
// (forward) or recedes (the "going backward" complaint). Enters a pic, walks to
// the next in-sequence pic, and screenshots across the transition.
import { chromium } from 'playwright';

const url = process.env.TARGET_URL || 'http://web/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

const info = await page.evaluate(async () => {
  const { getSequence } = await import('./src/panoramax.js');
  const sv = await import('./src/streetview.js');
  const { map } = await import('./src/main.js');
  const seq = (await getSequence('a5dc43dc-d62e-457b-ad15-822bd7ced0db', 30)).filter((p) => p.type === 'equirectangular');
  const a = seq[0];
  const b = seq.find((p) => p.id !== a.id);
  sv.enterStreetView(map, a);
  const w = (f, ms) => new Promise((r) => { const t = performance.now(); const k = () => (f() || performance.now() - t > ms ? r() : requestAnimationFrame(k)); k(); });
  await w(() => sv._photosphere()?.mode === 'inside', 12000);
  // face the travel direction (bearing a->b) so "forward" is on screen
  const ps = sv._photosphere();
  const br = Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180 / Math.PI;
  ps._yawDeg = (br + 360) % 360; ps._pitchDeg = -4; ps._updateCameraWhileInside();
  window.__sv = sv; window.__map = map; window.__b = b;
  return { aId: a.id.slice(-6), bId: b.id.slice(-6), bearingAB: Math.round((br + 360) % 360) };
}, undefined);
console.log('[walk]', JSON.stringify(info));

await page.waitForTimeout(600);
await page.screenshot({ path: '/work/out/walk_0_before.png' });

// pre-warm + start the walk, sample mid-transition
await page.evaluate(async () => {
  const b = window.__b;
  await new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = res; im.onerror = res; im.src = b.assets.sd || b.assets.hd; });
  window.__sv.enterStreetView(window.__map, b);
});
for (const [tag, ms] of [['1_t200', 200], ['2_t400', 400], ['3_t650', 650], ['4_done', 1600]]) {
  await page.waitForTimeout(tag === '1_t200' ? 200 : (ms - (tag === '2_t400' ? 200 : tag === '3_t650' ? 400 : 650)));
  const mix = await page.evaluate(() => ({ mix: +(window.__sv._photosphere()._mix || 0).toFixed(2), transitioning: window.__sv._photosphere()._transitioning }));
  await page.screenshot({ path: `/work/out/walk_${tag}.png` });
  console.log('[walk] frame', tag, JSON.stringify(mix));
}
await browser.close();
