# Vendored: maplibre-gl-panoramax (gesture + edit) — VERBATIM, do not edit

`gesture.js` (pose-editor algebra) and `edit.js` (its dependency: pose
clamping/PATCH builders) are copied byte-for-byte from
clement-igonet/maplibre-gl-panoramax @ main (commit `71a83f6` lineage,
0.2.0-unreleased). Pin to the released npm package once 0.2.0 ships.

To update: copy `src/gesture.js` + `src/edit.js` from the release unchanged
and run the full suite. Local changes go upstream first, never here.
