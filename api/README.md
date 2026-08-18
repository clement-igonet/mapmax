# MapMax world-band API

Generates an **equirectangular band of the MapLibre 3D world** — the OSM
buildings and streets as the app renders them — seen from a street-level
stand-point, headlessly. It exists so orientation corrections (#142) are a
comparison between two equirects (vector world vs panorama), with no camera
gymnastics in the browser (#154).

## Generate an equirect

```sh
# Through the sandbox edge (the only environment carrying the API today):
curl -o worldband.png --max-time 300 \
  "https://sandbox.mapmax.confinia.io/api/worldband?lon=2.3505&lat=48.8532"
```

- First request for a spot: **~2–3 minutes** (a headless Chromium builds the
  scene and spins through 360° under software GL) — hence `--max-time 300`.
- Any later request within ~1 m: **sub-second**, served from the cache.
  Measured: `200`, 8 119 bytes, 1.4 s over HTTPS for the example above.

From the VM (through the sandbox edge on its 1PESI port):

```sh
curl -o worldband.png --max-time 300 \
  "http://127.0.0.1:14400/api/worldband?lon=2.3505&lat=48.8532"
```

## Endpoint

`GET /api/worldband`

| param | required | default | meaning |
|---|---|---|---|
| `lon` | yes | — | stand-point longitude, −180…180 |
| `lat` | yes | — | stand-point latitude, −85…85 |
| `bins` | no | 180 | azimuth columns (36…360); 180 = one column per 2° |

**Response** — `image/png`, `bins × 96` pixels, RGBA:

- Column `j` is world azimuth `j · 360/bins` (column 0 = north, a quarter of
  the way in = east) — the same indexing the app's photo band uses, so a yaw
  error between the two images is a pure horizontal shift.
- Rows span **60° of elevation centred on the horizon** (0.625°/row): enough
  to contain rooflines for the skyline fit and façade texture for the
  vertical-correlation fit.
- `Cache-Control: public, max-age=86400` and CORS `*`.

**Errors** — `400` for out-of-range `lon`/`lat`; `502` with a plain-text
reason when the render itself fails (the failure never poisons later
requests).

## Semantics worth knowing

- **Zero drift by construction**: the renderer page (`api/renderer.html`)
  imports the app's own modules — hardened style, `ensureBuildings3D`, street
  backdrop, the photosphere camera, and `scanWorldStrip` itself — so this PNG
  is pixel-compatible with what an in-browser scan of the same spot would
  produce. If the app's scene changes, the API changes with it.
- **Cache key** rounds coordinates to 5 decimals (≈1.1 m) — finer requests
  are deliberately collapsed, GPS noise being larger than that. The cache is
  a named volume (`worldband-cache`) and survives container recreation.
- **Single-flight**: concurrent requests for one key share one render;
  requests for different keys queue (one Chromium page at a time).
- The band depends on `(lon, lat, bins, style)` only — nothing per-user.

## Topology

Sandbox-only (#146-clean): the `api` container is owned by
`mapmax-sandbox-stack.service`, routed exclusively by the sandbox edge
(`handle /api/*` in `docker/Caddyfile.sandbox`), publishes **no host port**,
and is invisible to production and Pages — where the app states plainly that
corrections need the API rather than degrading. `tests/unit/docker_test.js`
asserts this wiring.
