#!/usr/bin/env bash
# vendor-maplibre.sh <repo> <ref> [dest-dir]
#
# Build maplibre-gl-js from an arbitrary repo@ref via the CONTAINERIZED compose
# build (build/maplibre/docker-compose.yml) and copy the ESM dist into a vendor
# dir. Lets us run an UNRELEASED build — e.g. a fork branch carrying maplibre#8057
# (position-only LOD) — which has no pre-built bundle. See mapmax#94 / mapmax#91.
#
#   scripts/vendor-maplibre.sh clement-igonet/maplibre-gl-js feat/position-only-lod-8057 vendor/maplibre-8057
#
# Requires podman-compose. Pins the built commit SHA (in <dest>/VENDOR.txt) for
# reproducibility.
set -euo pipefail

REPO="${1:?usage: vendor-maplibre.sh <repo> <ref> [dest-dir]}"
REF="${2:?ref required (branch, tag or sha)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${3:-$ROOT/vendor/maplibre}"
[[ "$DEST" = /* ]] || DEST="$ROOT/$DEST"
BUILD_DIR="$ROOT/build/maplibre"
OUT="$BUILD_DIR/out"

mkdir -p "$OUT"
rm -f "$OUT"/*.mjs "$OUT"/*.css "$OUT"/SHA 2>/dev/null || true

echo ">> building $REPO @ $REF (containerized: build/maplibre/docker-compose.yml)"
REPO="$REPO" REF="$REF" podman-compose -f "$BUILD_DIR/docker-compose.yml" run --rm build

for f in maplibre-gl.mjs maplibre-gl-shared.mjs maplibre-gl-worker.mjs maplibre-gl.css; do
  [ -s "$OUT/$f" ] || { echo "build produced no $f" >&2; exit 1; }
done
mkdir -p "$DEST"
cp "$OUT"/maplibre-gl.mjs "$OUT"/maplibre-gl-shared.mjs "$OUT"/maplibre-gl-worker.mjs "$OUT"/maplibre-gl.css "$DEST/"
SHA="$(cat "$OUT/SHA")"
{ echo "$REPO @ $REF"; echo "$SHA"; date -u +%FT%TZ; } > "$DEST/VENDOR.txt"

VER="$(grep -o 'blob/v[0-9][^/\"]*' "$DEST/maplibre-gl.mjs" | head -1 | sed 's#blob/##')"
echo ">> vendored $REPO@$REF ($SHA) -> $DEST  [reports ${VER:-unknown}]"
