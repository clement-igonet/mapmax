// #47 roll/pitch calibration: enter a pic with known camera tilt and sweep the
// applied roll to find the sign that LEVELS the horizon (vertical façades become
// vertical). PIC defaults to 65ab0c8d (pers:roll = 6.6°).
import { chromium } from 'playwright';

const PIC = process.env.PIC_ID || '65ab0c8d-6c9b-4f35-b8fb-a156f4302379';
const url = process.env.TARGET_URL || 'http://web/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

const info = await page.evaluate(async (pic) => {
  const { getPicture } = await import('./src/panoramax.js');
  const sv = await import('./src/streetview.js');
  const { map } = await import('./src/main.js');
  const p = await getPicture(pic);
  sv.enterStreetView(map, p);
  const w = (f, ms) => new Promise((r) => { const t = performance.now(); const k = () => (f() || performance.now() - t > ms ? r() : requestAnimationFrame(k)); k(); });
  await w(() => sv._photosphere()?.mode === 'inside', 12000);
  window.__sv = sv;
  return { heading: p.heading, roll: p.roll, pitch: p.pitch };
}, PIC);
console.log('[calib] pic', JSON.stringify(info));

async function shot(tag, roll, pitch) {
  await page.evaluate(({ roll, pitch, h }) => {
    const ps = window.__sv._photosphere();
    ps._panoRollDeg = roll;
    ps._panoPitchDeg = pitch;
    ps._yawDeg = h;
    ps._pitchDeg = 0;
    ps._updateCameraWhileInside();
    ps._map.triggerRepaint();
  }, { roll, pitch, h: info.heading });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/work/out/roll_${tag}.png` });
  console.log('[calib] shot', tag, 'roll', roll);
}

// Isolate roll first: none / +metadata / -metadata.
await shot('none', 0, 0);
await shot('pos', info.roll, 0);
await shot('neg', -info.roll, 0);
await browser.close();
