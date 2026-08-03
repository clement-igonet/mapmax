#!/usr/bin/env bash
# Build maplibre-gl-js from $REPO@$REF and emit the ESM dist to /out.
# Runs inside the node container defined in this dir's docker-compose.yml.
set -euo pipefail
: "${REPO:?set REPO=owner/name or a clone URL}"
: "${REF:?set REF=branch|tag|sha}"

command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git >/dev/null; }
case "$REPO" in http*|git@*) URL="$REPO" ;; *) URL="https://github.com/$REPO.git" ;; esac

echo ">> cloning $URL @ $REF"
git clone --filter=blob:none --branch "$REF" "$URL" /src 2>/dev/null \
  || { git clone --filter=blob:none "$URL" /src && git -C /src checkout "$REF"; }
cd /src
SHA="$(git rev-parse HEAD)"

echo ">> npm ci"
npm ci --no-audit --no-fund
echo ">> npm run build-dist"
npm run build-dist

cp dist/maplibre-gl.mjs dist/maplibre-gl-shared.mjs dist/maplibre-gl-worker.mjs dist/maplibre-gl.css /out/
echo "$SHA" > /out/SHA
echo ">> built $REPO@$REF ($SHA)"
