# Vendored: maplibre-gl-photosphere — VERBATIM, do not edit

`tiles.js`, `pose.js` are the released npm package
`maplibre-gl-photosphere@0.4.0` (`package/src/*` from the registry tarball),
byte-for-byte. `index.js` is plugin main @ 05954e9 (0.4.0 + per-dot POI
color, upstreamed for #112) — PIN it back to the 0.5.0 release tarball when
that ships. MapMax consumes releases; it no longer forks the plugin (#110).

To update: fetch the new release tarball, copy `package/src/*.js` here
unchanged, and run the full suite. Anything MapMax needs that isn't in a
release goes upstream first (issue/PR on clement-igonet/maplibre-gl-photosphere),
never as a local patch.
