# ISSUES — work-in-flight tracker (R12)

At-a-glance status of issues and the PRs carrying them. Updated with every
issue/PR touch. Environments: [www](https://www.mapmax.confinia.io) ·
[staging](https://staging.mapmax.confinia.io) ·
[sandbox](https://sandbox.mapmax.confinia.io) ·
[Pages](https://clement-igonet.github.io/mapmax/).

## In progress

| Issue | Title | PR(s) | State |
|---|---|---|---|
| [#98](https://github.com/clement-igonet/mapmax/issues/98) | Pose corrector (pitch/roll/yaw) + Panoramax PATCH write-back | [#100](https://github.com/clement-igonet/mapmax/pull/100) (draft) | implemented; unit 109 ✓ + containerized e2e ✓; **branch build live on [sandbox](https://sandbox.mapmax.confinia.io) for the visual check** (until the next main deploy rebuilds it) |
| [#103](https://github.com/clement-igonet/mapmax/issues/103) | Adopt stock MapLibre ≥ v6.20 (with #8057) on all envs | — | promotion path decided; **blocked upstream** (latest v6.1.0, [maplibre#8057](https://github.com/maplibre/maplibre-gl-js/issues/8057) open) |
| [#94](https://github.com/clement-igonet/mapmax/issues/94) | Sandbox runs the #8057 (position-only LOD) MapLibre build | [#89](https://github.com/clement-igonet/mapmax/pull/89) (harness) | build live on [sandbox](https://sandbox.mapmax.confinia.io); baseline −26% tiles; promotion now via #103 (stock ≥ v6.20), fork stays sandbox-only |
| [#90](https://github.com/clement-igonet/mapmax/issues/90) | Sandbox reliably online + branch/PR deploys | — | stack is a systemd user service under `mapmax` (see MOVE.md); branch-deploy flow still manual |

## Backlog (open, not started)

| Issue | Title | Notes |
|---|---|---|
| [#93](https://github.com/clement-igonet/mapmax/issues/93) | Panorama loading-progress indicator | |
| [#92](https://github.com/clement-igonet/mapmax/issues/92) | Sandbox soft 360° usage counter (100) | |
| [#87](https://github.com/clement-igonet/mapmax/issues/87) | Position-only tile/LOD (app-level) | app-side mitigations shipped (#87 gate pin, #95 clip); full fix tracked upstream via #94 |
| [#86](https://github.com/clement-igonet/mapmax/issues/86) | Deep-link straight into the photosphere | |
| [#83](https://github.com/clement-igonet/mapmax/issues/83) | Near façades vs fill-extrusion limits | |
| [#63](https://github.com/clement-igonet/mapmax/issues/63) | Suggest fixes on photo↔vector gap | partly superseded by #98 write-back |
| [#58](https://github.com/clement-igonet/mapmax/issues/58) | Cap street-mode blend to a near-only source | |
| [#47](https://github.com/clement-igonet/mapmax/issues/47) | Use picture metadata for placement | partly superseded by #98 |
| [#46](https://github.com/clement-igonet/mapmax/issues/46) | Flat pictures as located patches | |

## Recently closed

| Issue | Title | Resolution |
|---|---|---|
| [#101](https://github.com/clement-igonet/mapmax/issues/101) | Default Photo ↔ Vector blend to 50%/50% | [#102](https://github.com/clement-igonet/mapmax/pull/102) merged; unit + containerized e2e green; deployed via CI; closed 2026-08-03 |
| [#95](https://github.com/clement-igonet/mapmax/issues/95) | Street building radius clip (pitch-90 stability) | [#96](https://github.com/clement-igonet/mapmax/pull/96) + [#97](https://github.com/clement-igonet/mapmax/pull/97) + [#99](https://github.com/clement-igonet/mapmax/pull/99); live on all envs; closed 2026-08-03 |
| [#91](https://github.com/clement-igonet/mapmax/issues/91) | Prototype #8057 locally (pre-code validation) | realized via #94's sandbox build; closed 2026-08-03 |
