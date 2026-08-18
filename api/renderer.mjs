// World-band renderer (#154) — the browser half of the headless API. Reuses
// the app's modules end to end; the only code of its own is glue.
import * as maplibregl from 'maplibre-gl';
import { OSM_STYLE_URL, PHOTOSPHERE, STREET_MAX_PITCH } from '../src/config.js';
import { hardenStyle } from '../src/stylefix.js';
import { ensureBuildings3D } from '../src/buildings.js';
import { applyStreetBackdrop } from '../src/backdrop.js';
import { Photosphere } from '../src/vendor/photosphere/index.js';
import { SCAN_BINS, scanWorldStrip } from '../src/autoscan.js';

// 1×1 transparent PNG: the photosphere needs SOME texture, but at blend 0 the
// photo layer is invisible anyway — only the camera geometry matters.
const TRANSPARENT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const done = (result) => { window.__worldband = result; };

try {
  const q = new URLSearchParams(location.search);
  const lon = Number(q.get('lon'));
  const lat = Number(q.get('lat'));
  const bins = Math.min(360, Math.max(36, Number(q.get('bins')) || SCAN_BINS));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('lon/lat required');

  const style = hardenStyle(await (await fetch(OSM_STYLE_URL)).json());
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: [lon, lat],
    zoom: 18,
    maxPitch: STREET_MAX_PITCH,
    centerClampedToGround: false,
    interactive: false,
  });
  await new Promise((r) => map.on('load', r));
  ensureBuildings3D(map);
  applyStreetBackdrop(map);

  const target = { lngLat: [lon, lat], imageUrl: TRANSPARENT, bearing: 0, panoYaw: 0, panoPitch: 0, panoRoll: 0, tiles: null };
  const ps = new Photosphere(map, {
    ...PHOTOSPHERE,
    lngLat: target.lngLat,
    imageUrl: TRANSPARENT,
    exitView: { center: target.lngLat, zoom: 17, pitch: 45, bearing: 0 },
  });
  ps.enter(target);
  await new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      if (ps.mode === 'inside') return resolve();
      if (performance.now() - t0 > 30000) return reject(new Error('photosphere never entered'));
      requestAnimationFrame(tick);
    };
    tick();
  });

  const strip = await scanWorldStrip(map, ps, {
    bins,
    setBlend: (a) => ps.blend(a),
    blendAfter: 0,
    shouldAbort: () => false,
    // Live progress for the /status endpoint (#154): the server polls this.
    onProgress: (p, phase) => { window.__progress = { pct: Math.round(p * 100), phase }; },
  });
  const c = document.createElement('canvas');
  c.width = strip.width;
  c.height = strip.height;
  c.getContext('2d').putImageData(strip, 0, 0);
  done({ ok: true, dataUrl: c.toDataURL('image/png'), width: strip.width, height: strip.height });
} catch (err) {
  done({ ok: false, error: String(err && err.message || err) });
}
