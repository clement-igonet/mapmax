# MapMax — Levels of Detail (LOD)

What MapMax draws at each zoom, and why. The goal is a light data budget: never
render (or load) more than is usable at the current scale. Zooms are MapLibre
zoom levels (512‑px tiles). Values below are the source of truth for the code in
[`src/config.js`](src/config.js), [`src/panoramax.js`](src/panoramax.js),
[`src/mapclutter.js`](src/mapclutter.js) and [`src/main.js`](src/main.js).

## Tiers

| LOD | Zoom | OSM base | Panoramax sequences (lines) | Panoramax pictures (dots) | 3D buildings | Camera / notes |
|-----|------|----------|-----------------------------|---------------------------|--------------|----------------|
| **L0 — World / Region** | `0–9`   | low‑detail ground | — | — | — | flat overview |
| **L1 — City**           | `10–12` | streets, water | **on** (thin, coverage overview) | — | — | dots would be an unusable swarm here |
| **L2 — District**       | `13–15` | full streets, labels | on (thicker) | — | — | no buildings yet — at this scale they'd be far clutter (#80) |
| **L3 — Street**         | `16–17` | full | on | **on** from `z17` (clickable) | — | clickable dots appear; tilt capped so they don't march to the horizon (#41, #56) |
| **L4 — Immersive**      | `18+` / on dot click | suspended | (n/a) | neighbours ≤ `50 m`, as ground arrows/dots | **on** from `z18` (extrusions) | usable near scale: 3D buildings appear; inside the 360° photosphere tiled layers suspended, OSM resumes at blend (#27, #82) |

Default landing view: `z18.5`, pitch `55°` ([`START_VIEW`](src/config.js)) — strictly
above both the z17 dot threshold and the z18 building gate
(`BUILDINGS_MIN_ZOOM`), so 360° positions and 3D buildings both show immediately
(#78, #82).

**Distance budget** (the governing rule, #80/#82): show vector tiles + building
extrusions **close to the camera at high zoom, and as little as possible
beyond** — but kept simple, with no per-feature distance culling. A layer's
`minzoom` is a global map-zoom gate, so gating buildings to `z18+` means they
only appear once you're zoomed right in (near, street scale); at lower zoom the
far city renders without them. The map-mode tilt cap (#41) additionally keeps the
far plane within ~160 m so distant tiles are never pulled at street zoom.

## Triggers & knobs

| Thing | Trigger | Where |
|-------|---------|-------|
| Sequence lines | source `minzoom 0`, line-width ramps `z10→16` | `panoramax.js` (`panoramax-sequences`) |
| Picture dots | layer `minzoom 17`, radius ramps `z17→22` | `panoramax.js` (`panoramax-pictures`) — **#56** |
| Panoramax source | `minzoom 0`, `maxzoom 15` (overzoomed above) | `panoramax.js` (`SOURCE_ID`) |
| 3D buildings (map mode) | `minzoom 18` (L4; Liberty `building-3d` clamped via `setLayerZoomRange`, or the fallback `mapmax-buildings-3d`) | `main.js` (`BUILDINGS_MIN_ZOOM`, #82) |
| 3D buildings (street mode) | gate pinned to `z15` so pitch drift doesn't blink the whole layer (#87); **radius-clipped** to `STREET_BUILDINGS_RADIUS_M = 150 m` of the standpoint via a `distance` filter — position-only, so looking around never re-clips, and far dense tiles that overflow MapLibre's 65535-vtx/segment fill-extrusion limit aren't drawn (#95) | `main.js`, `buildings.js` (#87, #95) |
| Map clutter cap | pitch capped so the top of the viewport stays within `MAP_VISIBLE_RADIUS_M = 160 m`; tilt unlocks as you zoom in; never below `MAP_MIN_PITCH_CAP = 20°` | `mapclutter.js` (#41) |
| Enter photosphere | click a picture dot (equirectangular only) | `main.js` → `streetview.js` |
| Street-mode POIs | neighbours within `STREET_POI_RADIUS_M = 50 m`, shader ground arrows/dots | `navigation.js`, photosphere plugin (#26/#39) |
| Street-mode tiles | all tiled layers suspended while inside; blend < 1 resumes OSM only (Panoramax tiles stay suspended) | `tilebudget.js` (#11/#27) |

## Rationale

- **Dots are the heavy layer.** At `z16` the whole city of picture points renders
  at once (~thousands of dots, tens of MB). Gating them to `z17+` (#56) keeps the
  city/district views to sequence lines + buildings only — coverage without the
  swarm.
- **Sequences give coverage cheaply.** Thin lines convey where imagery exists at
  city scale without per-picture geometry.
- **Tilt is bounded, not the far plane.** MapLibre v6 has no fog / distance
  expression, so the clutter cap (#41) limits pitch by zoom so the tilted map
  never renders content out to the horizon; the effect is a soft distance budget.
- **Immersive mode is self-contained.** Inside a photosphere the map tiles are
  suspended and only nearby (≤ 50 m) neighbours load, so walking a sequence never
  pulls city-wide data.
- **Buildings: zoom-gated in map mode, radius-clipped in street mode.** Map mode
  keeps the simple `z18` `minzoom` (no per-feature culling, #82). Street mode is
  different: at pitch ≈ 90 the frustum grazes the horizon, so far dense z14 tiles
  (a) overflow MapLibre's **65535-vertices-per-segment** fill-extrusion limit and
  get dropped, and (b) churn in/out of the frustum — both read as buildings
  blinking. A per-standpoint `distance` filter (≤ 150 m, `buildings.js`) clips them
  to the near set: buckets stay small (no overflow) and the set is **position-only**
  (looking around never re-clips). Runtime-tunable: `?buildingsRadius=<m>` or the
  `setBuildingsRadius(m)` console setter (#95).

## Street view & the position-only LOD experiment (maplibre#8057)

Inside the photosphere the eye is fixed and you *look around*, so the base tiles'
desired zoom shouldn't depend on look direction. MapLibre's default covering keys
LOD on the view *centre* (orientation), so rotating re-LODs and re-culls tiles.
The **sandbox** env runs a vendored MapLibre build with a position-only LOD change
(camera→tile distance, pitch-independent reference + a min-zoom floor) — see
[maplibre#8057](https://github.com/maplibre/maplibre-gl-js/issues/8057). Prod and
staging run stock 6.1.0. The radius clip above is the app-side companion that also
sidesteps the fill-extrusion overflow the experiment surfaced.

## Related issues

#41 (map clutter cap), #56 (dot zoom gate), #27 (street tile budget), #11
(suspend tiles inside), #39/#26 (in-shader ground overlays), #87 (street building
gate pin), #95 (street building radius clip), maplibre#8057 (position-only LOD).
