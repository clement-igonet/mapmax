# ISSUES — work-in-flight tracker (R12)

At-a-glance status of issues and the PRs carrying them. Updated with every
issue/PR touch. Environments: [www](https://www.mapmax.confinia.io) ·
[staging](https://staging.mapmax.confinia.io) ·
[sandbox](https://sandbox.mapmax.confinia.io) ·
[Pages](https://clement-igonet.github.io/mapmax/).

## In progress

| Issue | Title | PR(s) | State |
|---|---|---|---|
| [#103](https://github.com/clement-igonet/mapmax/issues/103) | Adopt stock MapLibre ≥ v6.20 (with #8057) on all envs | — | promotion path decided; **blocked upstream** (latest v6.1.0, [maplibre#8057](https://github.com/maplibre/maplibre-gl-js/issues/8057) open) |
| [#94](https://github.com/clement-igonet/mapmax/issues/94) | Sandbox runs the #8057 (position-only LOD) MapLibre build | [#89](https://github.com/clement-igonet/mapmax/pull/89) (harness) | build live on [sandbox](https://sandbox.mapmax.confinia.io); baseline −26% tiles; promotion now via #103 (stock ≥ v6.20), fork stays sandbox-only |
| [#90](https://github.com/clement-igonet/mapmax/issues/90) | Sandbox reliably online + branch/PR deploys | — | stack is a systemd user service under `mapmax` (see MOVE.md); **branch→sandbox deploys now CI-driven** ([#117](https://github.com/clement-igonet/mapmax/pull/117), R14: `workflow_dispatch` on any ref, sandbox-only off main) |

## Backlog (open, not started)

| Issue | Title | Notes |
|---|---|---|
| [#112](https://github.com/clement-igonet/mapmax/issues/112) | Multi-source 360° imagery (Mapillary, Commons, self-hosted, …) | survey in [SOURCES.md](SOURCES.md); adapter interface first; editing stays Panoramax/GeoVisio-only |
| [#93](https://github.com/clement-igonet/mapmax/issues/93) | Panorama loading-progress indicator | |
| [#92](https://github.com/clement-igonet/mapmax/issues/92) | Sandbox soft 360° usage counter (100) | |
| [#87](https://github.com/clement-igonet/mapmax/issues/87) | Position-only tile/LOD (app-level) | app-side mitigations shipped (#87 gate pin, #95 clip); full fix tracked upstream via #94 |
| [#86](https://github.com/clement-igonet/mapmax/issues/86) | Deep-link straight into the photosphere | |
| [#83](https://github.com/clement-igonet/mapmax/issues/83) | Near façades vs fill-extrusion limits | |
| [#58](https://github.com/clement-igonet/mapmax/issues/58) | Cap street-mode blend to a near-only source | more pressing since the 50/50 default (#101) |
| [#46](https://github.com/clement-igonet/mapmax/issues/46) | Flat pictures as located patches | |

## Recently closed

| Issue | Title | Resolution |
|---|---|---|
| [#110](https://github.com/clement-igonet/mapmax/issues/110) | Graduate vendored photosphere improvements to maplibre-gl-photosphere | [maplibre-gl-photosphere v0.4.0](https://github.com/clement-igonet/maplibre-gl-photosphere/releases/tag/v0.4.0) released canonically (bump PR → npm + tag + GH Release, [PR #114](https://github.com/clement-igonet/mapmax/pull/114) un-forks MapMax onto the verbatim release files + VENDOR.md); gesture/edit vendored from [maplibre-gl-panoramax](https://github.com/clement-igonet/maplibre-gl-panoramax)@main (repo at 0.1.0, 0.2.0 staged under `## main`, npm bootstrap pending user token); closed 2026-08-12 |
| [#111](https://github.com/clement-igonet/mapmax/issues/111) | Reader chrome + product pivot: READ-oriented, local-only 🔧 Adjust | [#113](https://github.com/clement-igonet/mapmax/pull/113) merged (true-merge of the #108→#109→#113 train); auth/write-back removed app-wide (lives on in maplibre-gl-panoramax); deployed & verified all envs; closed 2026-08-11 |
| [#107](https://github.com/clement-igonet/mapmax/issues/107) | Position edit: compass pad + elevation scale + ground/minimap drag (local) | via [#109](https://github.com/clement-igonet/mapmax/pull/109) in the #113 train; world-anchored nav dots; closed 2026-08-11 |
| [#106](https://github.com/clement-igonet/mapmax/issues/106) | Pose edit mode: drag the photo + roll ring | via [#108](https://github.com/clement-igonet/mapmax/pull/108) in the #113 train; gesture maths graduated to the plugin stack (#110); closed 2026-08-11 |
| [#104](https://github.com/clement-igonet/mapmax/issues/104) | "Connect to Panoramax" (OAuth claim flow) — automate token retrieval | [#105](https://github.com/clement-igonet/mapmax/pull/105) merged: generate→claim→poll + late-claim adoption, per-instance session tokens, panel-rendering hardening; user-validated on sandbox; deployed all envs; closed 2026-08-07 |
| [#98](https://github.com/clement-igonet/mapmax/issues/98) | Pose corrector (pitch/roll/yaw) + Panoramax PATCH write-back | [#100](https://github.com/clement-igonet/mapmax/pull/100) merged (incl. panel-rendering fixes, token-help link, README how-to); validated on sandbox by the user; deployed via CI; closed 2026-08-04 |
| [#47](https://github.com/clement-igonet/mapmax/issues/47) | Use picture metadata for placement | superseded/resolved by #98; closed 2026-08-04 |
| [#63](https://github.com/clement-igonet/mapmax/issues/63) | In-app metadata override + editor deep-links | superseded/resolved by #98 (write-back beats deep-links; #104 for one-click auth); closed 2026-08-04 |
| [#101](https://github.com/clement-igonet/mapmax/issues/101) | Default Photo ↔ Vector blend to 50%/50% | [#102](https://github.com/clement-igonet/mapmax/pull/102) merged; unit + containerized e2e green; deployed via CI; closed 2026-08-03 |
| [#95](https://github.com/clement-igonet/mapmax/issues/95) | Street building radius clip (pitch-90 stability) | [#96](https://github.com/clement-igonet/mapmax/pull/96) + [#97](https://github.com/clement-igonet/mapmax/pull/97) + [#99](https://github.com/clement-igonet/mapmax/pull/99); live on all envs; closed 2026-08-03 |
| [#91](https://github.com/clement-igonet/mapmax/issues/91) | Prototype #8057 locally (pre-code validation) | realized via #94's sandbox build; closed 2026-08-03 |
