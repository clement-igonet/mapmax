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
| **L2 — District**       | `13–15` | full streets, labels | on (thicker) | — | **on** from `z13` (extrusions) | tilt capped so buildings don't march to the horizon (#41) |
| **L3 — Street**         | `16–17` | full | on | **on** from `z17` (clickable) | on | usable scale: dots appear only when you can actually click one (#56) |
| **L4 — Immersive**      | `18+` / on dot click | suspended | (n/a) | neighbours only, ≤ `50 m`, as ground arrows/dots | suspended | inside the 360° photosphere; tiles suspended (#27) |

Default landing view: `z16.5`, pitch `55°` ([`START_VIEW`](src/config.js)).

## Triggers & knobs

| Thing | Trigger | Where |
|-------|---------|-------|
| Sequence lines | source `minzoom 0`, line-width ramps `z10→16` | `panoramax.js` (`panoramax-sequences`) |
| Picture dots | layer `minzoom 17`, radius ramps `z17→22` | `panoramax.js` (`panoramax-pictures`) — **#56** |
| Panoramax source | `minzoom 0`, `maxzoom 15` (overzoomed above) | `panoramax.js` (`SOURCE_ID`) |
| 3D buildings | `minzoom 13` (fill-extrusion) | `main.js` (`mapmax-buildings-3d`) / Liberty `building-3d` |
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

## Related issues

#41 (map clutter cap), #56 (dot zoom gate), #27 (street tile budget), #11
(suspend tiles inside), #39/#26 (in-shader ground overlays).
