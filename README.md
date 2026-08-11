# MapMax

Street-level immersive navigation: [Panoramax](https://panoramax.fr) photospheres inside a [MapLibre GL JS](https://maplibre.org) map, with OSM ground and 3D buildings — Google-Street-View-like controls, open data only, front-end only.

See [SPECIFICATIONS.md](SPECIFICATIONS.md) for the full expectations.

## Run with containers (reference deployment)

```sh
podman compose up -d web        # build + serve on http://localhost:8080
# docker compose works identically
```

## Tests

```sh
deno task test                  # unit + fetch-level e2e against the deployed site
deno task test:unit             # pure logic only
podman compose run --rm e2e     # containerized Chromium end-to-end (against web)
TARGET_URL=https://clement-igonet.github.io/mapmax/ podman compose run --rm e2e
```

The full suite (Deno + containerized Chromium e2e) is run after each deployment.

## Fixing a panorama's rendering (locally)

MapMax is **read-oriented**: it visualizes open street-level imagery and never
writes to any server. Inside a 360° panorama, the header's **🔧 Adjust**
utility opens an edition mode to fix how the picture renders — drag rotates
the photo (ring = horizon, ↺ = 180° flip), the right-hand cluster moves it
(compass arrows, elevation scale, ⇧-drag the ground, drag the minimap). All
corrections apply live and persist **in your browser only** (localStorage).

Apps that want to write corrections back to a Panoramax instance can build on
[maplibre-gl-panoramax](https://github.com/clement-igonet/maplibre-gl-panoramax)
(pose/position PATCH builders + the sign-in claim flow, extracted from an
earlier MapMax iteration) — deliberately outside this app.

## Status

Work is tracked through [GitHub Issues](../../issues) and merged via Pull Requests.

👉 **[See the remaining open issues](https://github.com/clement-igonet/mapmax/issues?q=is%3Aissue+is%3Aopen)**

## Deployment

Deployed continuously from `main`:

- **GitHub Pages** (prod mirror): https://clement-igonet.github.io/mapmax/
- **confinia stack** — a single `docker-compose.yml` split into three named web
  services behind a Caddy edge (`docker/Caddyfile`), each an isolated image so
  environments can diverge cleanly:

  | env | host | image | env baked | notable |
  |-----|------|-------|-----------|---------|
  | **prod** | [www.mapmax.confinia.io](https://www.mapmax.confinia.io) | `Dockerfile` | `prod` | stock MapLibre 6.1.0 |
  | **staging** | [staging.mapmax.confinia.io](https://staging.mapmax.confinia.io) | `Dockerfile` (arg) | `staging` | pre-prod validator for candidate features |
  | **sandbox** | [sandbox.mapmax.confinia.io](https://sandbox.mapmax.confinia.io) | `docker/Dockerfile.sandbox` | `sandbox` | position-only-LOD MapLibre build (maplibre#8057) + `tools/` |

  The deployment env is baked per image (`Dockerfile ARG MAPMAX_ENV` → `src/env.js`);
  feature gating derives from it (`buildingsClipEnabled(env)`), so behaviour is
  deployment-driven, not URL-driven. A self-hosted runner on the VM runs the
  `ci-test.sh` gate (unit + containerized e2e) then rebuilds the stack, which runs
  as a persistent systemd user service (`mapmax-stack.service`).

## License

Code: MIT. Imagery: served by Panoramax instances under their own licenses (attribution shown in the UI). Map data: © OpenStreetMap contributors.
