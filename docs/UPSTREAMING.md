# Upstreaming map — what is MapMax-specific, what graduates to the plugin

Where each piece of the street-view stack belongs, and what upstream movement
could obsolete it. Three layers:

```
maplibre-gl-js (core)          rendering engine, tiles, camera
  └─ maplibre-gl-photosphere   generic 360° street-view plugin (own repo/npm)
       └─ MapMax               Panoramax product: data, persistence, write-back, UI
```

**Layering rule (2026-08-11, user decision):** maplibre-gl-photosphere stays a
source-agnostic 360° **viewer** — it may *render* corrections (pose model,
pose-aware tiles, `setPanoPose`, `setAnchor`) and expose neutral hooks
(`setPoseEditDrag`, `groundPointAt`), but ships **no editing**. Everything
editorial — gesture algebra, write-back, editor demos — belongs to
**maplibre-gl-panoramax** (the data-source layer; corrections live next to the
API that stores them). The only edit surface photosphere may ever demo is one
driven purely by OpenStreetMap data. Status: photosphere PR #4 (0.4.0, viewer
scope) + maplibre-gl-panoramax v0.1.0 released / 0.2.0 (gesture algebra)
unreleased.

## 1. Graduate to maplibre-gl-photosphere (generic 360° viewer/editor)

| Vendored delta | MapMax issue | Notes for the plugin API |
|---|---|---|
| **Pose model**: `uPanoRot`/`uPanoRot2` mat3 replacing yaw-only sampling; `setPanoPose()` / `getPanoPose()`; pose carried through enter/goTo/promote | #98/#100 | ships with `panoPoseMatrix()`; target option names: `panoYaw/panoPitch/panoRoll` |
| **Gesture engine**: `setPoseEditDrag(cb)` drag routing (camera untouched), view-space composition + Euler re-extraction (`composePoseGesture`, `poseFromMatrix`, `mat3Multiply`, `axisRotationMatrix`) | #106 | move the maths from [src/pose.js](../src/pose.js) into the plugin — it is viewer maths, not Panoramax maths |
| **Ground raycast**: `groundPointAt(px, py)` (+ `groundPick` refactor) | #26/#39/#107 | generic floor picking; enables ground-grab translation for any consumer |
| **Anchor editing**: `setAnchor(lngLat, eyeHeight)` live re-anchor | #107 | pairs with position-editing UIs |
| Walk transition (directional zoom, #64), enter/exit lifecycle, pendingExit, FOV sync (#24), in-shader nav arrows/POIs (#26/#39), blend (#6) | pre-#98 | already plugin-shaped; diff against the 07-29 state and release |
| **Rendering hygiene**: opaque small-chip overlay guidance; no promoted large surfaces over the canvas | #104/#106 saga | document as a README caveat for plugin consumers (GPU-hostile machines) |

Suggested plugin release: **v0.x “editor” minor** — pose model + gesture engine +
raycast + anchor as API (no DOM); MapMax then vendors the released build (or
imports from npm) instead of a hand-patched copy.

## 2. Stays in MapMax (product-specific)

- **Panoramax data layer**: STAC client, `via`-link home-instance resolution,
  item normalization, sun-compass flip (#66/#69/#71).
- **Write-back**: pose/position PATCH builders, Connect OAuth claim flow +
  token/session policy (#98/#104/#107) — Panoramax-protocol, not viewer.
- **Persistence**: per-sequence pose / per-picture position localStorage model.
- **Editor DOM**: the chip panel, roll ring, elevation gauge, compass pad,
  minimap-drag (#106/#107). The plugin gets the *API*; MapMax owns the *UI*.
  (A later optional unstyled `photosphere-editor-controls` helper in the plugin
  repo is possible once the API stabilizes — not before.)
- **Style/tile policy**: tile-budget suspension (#11/#27), street backdrop
  (#37/#43), buildings gate/radius clip (#87/#95), clutter cap (#41), blend
  default (#101), env gating.

## 3. Upstream watch — maplibre-gl-js concurrent work

| Upstream | State (2026-08-07) | Overlap / retirement plan |
|---|---|---|
| [#8057](https://github.com/maplibre/maplibre-gl-js/issues/8057) position-only tile LOD (+ closed PR #8059, our `firstPersonLod` spec) | open; latest release v6.1.0 without it | when a stock release ships it: adopt everywhere, retire the sandbox fork (**#103**), relax the #87 gate pin |
| [#1136](https://github.com/maplibre/maplibre-gl-js/issues/1136) “360 immersive” | open (long-lived umbrella) | native 360 support in core would eventually subsume the plugin's sampling shader — **watch before investing in deep plugin rendering work**; the editor API/gestures survive either way (they'd drive the native layer) |
| Fog: [#4337](https://github.com/maplibre/maplibre-gl-js/issues/4337), [#4985](https://github.com/maplibre/maplibre-gl-js/issues/4985), [#4986](https://github.com/maplibre/maplibre-gl-js/issues/4986) | open | native fog/distance culling would replace the clutter cap (#41) and the near-only street source ambition (#58) with a style property |
| fill-extrusion 65535-vtx/segment limit (no `fillLargeMeshArrays` path; surfaced by us on #8057) | unaddressed | until fixed, the #95 radius clip stays mandatory; if fixed, the clip becomes an optimization, not a correctness fix |
| #7932 high-pitch tile culling | shipped in v6.1.0 | already consumed; nothing to do |

**Working rule:** before adding *rendering* capability to the plugin, check
#1136/#8057 movement; before adding *style/tile policy* to MapMax, check the fog
issues. Editor/gesture/API work is safe — no upstream overlap exists there.

## 4. Suggested sequence

1. Merge #108/#109 (editor complete in the vendored copy).
2. Diff vendored copy vs plugin@07-29; port + release plugin v0.x (pose, gestures,
   raycast, anchor; changelog crediting the MapMax issues).
3. Point MapMax at the released plugin build; delete the hand-patched divergence
   (keep vendoring the *built* file — R3 buildless stays).
4. Re-check #8057/#1136 quarterly (tie to #103's release watch).
