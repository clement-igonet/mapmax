// Ad-hoc screenshot capture: enter a real panorama, populate nav arrows, look
// toward an arrow at a grazing downward pitch, and screenshot — visual proof the
// shader ground arrows render un-cropped (#26). Writes PNGs to /work/out/.
import { chromium } from 'playwright';

const url = process.env.TARGET_URL || 'http://web/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('#map canvas', { timeout: 30000 });

const info = await page.evaluate(async () => {
  const { getSequence } = await import('./src/panoramax.js');
  const sv = await import('./src/streetview.js');
  const navMod = await import('./src/navigation.js');
  const { map } = await import('./src/main.js');
  const seq = await getSequence('a5dc43dc-d62e-457b-ad15-822bd7ced0db', 30);
  const pano = seq.find((p) => p.type === 'equirectangular') || seq[0];
  sv.enterStreetView(map, pano);
  const waitFor = (pred, ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (pred() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  await waitFor(() => sv._photosphere()?.mode === 'inside', 10000);
  await waitFor(() => navMod._navArrows().length > 0, 8000);
  const arrows = navMod._navArrows();
  window.__sv = sv;
  window.__arrows = arrows;
  return { arrowCount: arrows.length, bearings: arrows.map((a) => Math.round(a.bearing)) };
});
console.log('[capture] arrows:', JSON.stringify(info));

// Look straight toward the first arrow, then sweep pitch from gentle to steep
// down. A near-plane-cropped arrow would show a hard horizontal cut; the shader
// arrow must stay a full chevron at every pitch.
for (const pitch of [-10, -18, -28, -45]) {
  await page.evaluate((p) => {
    const sv = window.__sv;
    const ps = sv._photosphere();
    ps._yawDeg = window.__arrows[0].bearing;
    ps._pitchDeg = p;
    ps._updateCameraWhileInside();
    ps._map.triggerRepaint();
  }, pitch);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/work/out/arrow_pitch${Math.abs(pitch)}.png` });
  console.log(`[capture] shot pitch ${pitch}`);
}
await browser.close();
