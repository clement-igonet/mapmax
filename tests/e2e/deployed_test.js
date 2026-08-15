// End-to-end smoke tests against the DEPLOYED site and the live upstream APIs.
// Run after each deployment: `deno task test:e2e`
// Override the target with DEPLOY_URL=... for local checks.
import { assert, assertEquals } from 'jsr:@std/assert@1';

const BASE = (Deno.env.get('DEPLOY_URL') || 'https://clement-igonet.github.io/mapmax').replace(/\/$/, '');

Deno.test('deployed page is served and wires the app (issue #1)', async () => {
  const res = await fetch(`${BASE}/index.html`);
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(html.includes('vendor/maplibre/maplibre-gl.mjs'), 'vendored MapLibre importmap missing (#19, PR #7932 build)');
  assert(html.includes('maplibre-gl.mjs'), 'ESM maplibre importmap missing (issue #19)');
  assert(html.includes('src/main.js'), 'app module missing');
  assert(html.includes('exit-street'), 'street exit button missing (issue #3)');
  assert(html.includes('rel="icon"'), 'favicon missing (issue #14)');
});

Deno.test('deployed app hardens style against console errors (issue #14)', async () => {
  const js = await (await fetch(`${BASE}/src/main.js`)).text();
  assert(js.includes('styleimagemissing'), 'missing-sprite placeholder handler absent');
  assert(js.includes('loadHardenedStyle'), 'building height hardening absent');
});

Deno.test('deployed JS modules are served', async () => {
  const mods = ['config', 'main', 'geo', 'panoramax', 'streetview', 'navigation', 'arrows', 'stylefix', 'sources', 'mapillary', 'commons'];
  for (const mod of mods) {
    const res = await fetch(`${BASE}/src/${mod}.js`);
    assertEquals(res.status, 200, `src/${mod}.js not deployed`);
    await res.body?.cancel();
  }
  // The vendored maplibre-gl-photosphere 0.4.0 trio (#110 sync).
  for (const f of ['index', 'tiles', 'pose']) {
    const plugin = await fetch(`${BASE}/src/vendor/photosphere/${f}.js`);
    assertEquals(plugin.status, 200, `vendored photosphere ${f}.js not deployed`);
    await plugin.body?.cancel();
  }
  // The vendored maplibre-gl-panoramax gesture algebra + edit helpers (#110).
  for (const f of ['gesture', 'edit']) {
    const plugin = await fetch(`${BASE}/src/vendor/panoramax/${f}.js`);
    assertEquals(plugin.status, 200, `vendored panoramax ${f}.js not deployed`);
    await plugin.body?.cancel();
  }
  // Vendored MapLibre build (PR #7932) + its shared chunk and module worker.
  for (const f of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
    const res = await fetch(`${BASE}/vendor/maplibre/${f}`);
    assertEquals(res.status, 200, `vendored MapLibre ${f} not deployed`);
    await res.body?.cancel();
  }
});

Deno.test('OSM style has fill-extrusion 3D buildings (issue #1)', async () => {
  const style = await (await fetch('https://tiles.openfreemap.org/styles/liberty')).json();
  assert(style.layers.some((l) => l.type === 'fill-extrusion'), 'no 3D building layer');
});

Deno.test('Panoramax search returns usable pictures (issue #2)', async () => {
  const res = await fetch('https://api.panoramax.xyz/api/search?bbox=2.34,48.85,2.36,48.86&limit=3');
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(data.features.length > 0, 'no pictures in central Paris?');
  const f = data.features[0];
  assert(typeof f.properties['view:azimuth'] === 'number', 'heading metadata missing');
  assert(f.assets.hd?.href || f.assets.sd?.href, 'image assets missing');
});

Deno.test('Panoramax vector tiles respond (issue #2)', async () => {
  const res = await fetch('https://api.panoramax.xyz/api/map/14/8297/5637.mvt');
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test('Panoramax sequence returns ordered panoramas (plugin adoption)', async () => {
  const { getSequence } = await import('../../src/panoramax.js');
  const seq = await getSequence('a5dc43dc-d62e-457b-ad15-822bd7ced0db', 20);
  assert(seq.length > 1, 'expected a multi-picture sequence');
  // ranks are non-decreasing after the sort
  for (let i = 1; i < seq.length; i++) {
    assert((seq[i].rankInSequence ?? 0) >= (seq[i - 1].rankInSequence ?? 0), 'sequence not ordered');
  }
  assert(seq.some((p) => p.type === 'equirectangular'), 'no 360 panorama in sample sequence');
});

Deno.test('real Paris data yields navigation arrows (issue #4)', async () => {
  const { normalizeItem } = await import('../../src/panoramax.js');
  const { pickArrows } = await import('../../src/arrows.js');
  const data = await (
    await fetch('https://api.panoramax.xyz/api/search?bbox=2.349,48.854,2.351,48.856&limit=60')
  ).json();
  const pics = data.features.map(normalizeItem);
  const arrows = pickArrows(pics[0], pics);
  assert(arrows.length > 0, 'expected at least one arrow near a Paris picture');
  assert(arrows.every((a) => a.dist <= 30 && a.dist >= 1.5));
});

Deno.test('Panoramax images allow CORS for WebGL textures (issue #3)', async () => {
  const search = await (
    await fetch('https://api.panoramax.xyz/api/search?bbox=2.34,48.85,2.36,48.86&limit=1')
  ).json();
  const url = search.features[0].assets.thumb?.href || search.features[0].assets.sd?.href;
  const res = await fetch(url, { method: 'HEAD', headers: { Origin: 'https://clement-igonet.github.io' } });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  await res.body?.cancel();
});
