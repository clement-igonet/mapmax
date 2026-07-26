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

## Status

Work is tracked through [GitHub Issues](../../issues) and merged via Pull Requests.

👉 **[See the remaining open issues](https://github.com/clement-igonet/mapmax/issues?q=is%3Aissue+is%3Aopen)**

## Deployment

Deployed continuously to GitHub Pages from `main`: https://clement-igonet.github.io/mapmax/

## License

Code: MIT. Imagery: served by Panoramax instances under their own licenses (attribution shown in the UI). Map data: © OpenStreetMap contributors.
