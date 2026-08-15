# Vendored: maplibre-gl-photosphere 0.5.0 — VERBATIM, do not edit

`index.js`, `tiles.js`, `pose.js` are the released npm package
`maplibre-gl-photosphere@0.5.0` (`package/src/*` from the registry tarball),
byte-for-byte: 0.4.0 + per-dot POI colors (#112) + native flat-picture
projection (plugin #3). MapMax consumes releases; it no longer forks the
plugin (#110).

To update: fetch the new release tarball, copy `package/src/*.js` here
unchanged, and run the full suite. Anything MapMax needs that isn't in a
release goes upstream first (issue/PR on clement-igonet/maplibre-gl-photosphere),
never as a local patch.
