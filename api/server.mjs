// MapMax world-band API (#154) — a small Node server that renders the vector
// world's 360° horizon band HEADLESSLY and caches it.
//
//   GET /api/worldband?lon=&lat=[&bins=]  → image/png (bins × strip-height)
//   GET /healthz                          → 200 ok
//
// The render happens in Chromium (playwright) loading api/renderer.html, which
// runs the app's OWN modules — same style hardening, buildings, backdrop,
// camera and scanWorldStrip — so this band is pixel-compatible with an
// in-browser scan. The result depends only on (lon, lat, bins, style), so it
// is cached on disk at ~1 m resolution and rendered once per spot
// (single-flight: concurrent requests for one key share the render).
//
// Sandbox-only for now: owned by mapmax-sandbox-stack.service, routed by the
// sandbox edge (#146 isolation). No host port.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.env.SITE_ROOT || '/app';
const CACHE = process.env.CACHE_DIR || '/var/cache/worldband';
const RENDER_TIMEOUT_MS = 180000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

await mkdir(CACHE, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });

// One render at a time (the page is a shared resource); one promise per key so
// a burst of identical requests costs one render.
const inFlight = new Map();
let chain = Promise.resolve();

function renderKey(lon, lat, bins) {
  // 5 decimals ≈ 1.1 m — GPS noise makes finer keys pure cache misses.
  return `${lon.toFixed(5)}_${lat.toFixed(5)}_${bins}`;
}

async function renderBand(lon, lat, bins) {
  const key = renderKey(lon, lat, bins);
  const file = path.join(CACHE, `${key}.png`);
  try { await stat(file); return file; } catch { /* miss */ }
  if (!inFlight.has(key)) {
    const job = chain.then(async () => {
      try { await stat(file); return file; } catch { /* still a miss */ }
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
      page.on('pageerror', (e) => console.error('renderer pageerror:', String(e)));
      page.on('console', (m) => { if (m.type() === 'error') console.error('renderer console:', m.text().slice(0, 300)); });
      try {
        await page.goto(`http://127.0.0.1:${PORT}/api/renderer.html?lon=${lon}&lat=${lat}&bins=${bins}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction('window.__worldband', null, { timeout: RENDER_TIMEOUT_MS });
        const res = await page.evaluate(() => window.__worldband);
        if (!res.ok) throw new Error(res.error || 'renderer failed');
        await writeFile(file, Buffer.from(res.dataUrl.split(',')[1], 'base64'));
        return file;
      } finally {
        await page.close().catch(() => {});
      }
    });
    // Sequence the NEXT job after this one whatever happens — a rejected job
    // must fail its requesters, never poison the queue.
    chain = job.catch(() => {});
    inFlight.set(key, job.finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

async function serveStatic(req, res, urlPath) {
  const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(ROOT, clean);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (url.pathname === '/api/worldband') {
      const lon = Number(url.searchParams.get('lon'));
      const lat = Number(url.searchParams.get('lat'));
      const bins = Math.min(360, Math.max(36, Number(url.searchParams.get('bins')) || 180));
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 85) {
        res.writeHead(400).end('lon/lat out of range');
        return;
      }
      const file = await renderBand(lon, lat, bins);
      const png = await readFile(file);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        // The band changes when the style/data does — a day is a fine horizon.
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(png);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('worldband error:', err.message);
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' }).end(`render failed: ${err.message}`);
  }
}).listen(PORT, () => console.log(`worldband api on :${PORT}`));
