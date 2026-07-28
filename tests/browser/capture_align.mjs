// Calibration capture for #52: enter a specific panorama, reveal the vector
// layers (blend), hold the LOOK direction + vector map fixed, and sweep the
// texture heading offset panoYaw ∈ {0, +azimuth, -azimuth}. The vector view is
// identical across shots; only the photo rotates — the offset that makes the
// photo's buildings/road sit on the vector ones is the correct convention.
import { chromium } from 'playwright';

const PIC = process.env.PIC_ID || '2668bd15-3790-4fba-b76a-0aaf920f7519';
const url = process.env.TARGET_URL || 'http://web/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

const info = await page.evaluate(async (pic) => {
  const { getPicture } = await import('./src/panoramax.js');
  const sv = await import('./src/streetview.js');
  const { map } = await import('./src/main.js');
  const p = await getPicture(pic);
  sv.enterStreetView(map, p);
  const waitFor = (pred, ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  await waitFor(() => sv._photosphere()?.mode === 'inside', 12000);
  sv.setBlend(0.28); // reveal the vector layers behind the photo
  window.__sv = sv;
  window.__heading = p.heading || 0;
  return { heading: p.heading, type: p.type };
}, PIC);
console.log('[calib] pic', JSON.stringify(info));

async function shot(name, panoYaw, lookYaw, pitch) {
  await page.evaluate(({ panoYaw, lookYaw, pitch }) => {
    const ps = window.__sv._photosphere();
    ps._panoYawDeg = panoYaw;
    ps._yawDeg = lookYaw;
    ps._pitchDeg = pitch;
    ps._updateCameraWhileInside();
    ps._map.triggerRepaint();
  }, { panoYaw, lookYaw, pitch });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/work/out/${name}.png` });
  console.log('[calib] shot', name, 'panoYaw', panoYaw | 0);
}

const H = info.heading || 0;
await page.waitForTimeout(4500); // let the OSM vector tiles load so we can compare
// Look forward along the capture heading, gently down; before (0) vs fix (+H).
for (const [tag, py] of [['0', 0], ['plusH', H]]) {
  await shot(`vec_look${H | 0}_${tag}`, py, H, 2);
}
await browser.close();
