#!/usr/bin/env bash
# MapMax — promote the current checkout to the live confinia stack and verify.
# Runs on the self-hosted runner (as user `debian`, rootless podman) after the
# CI gate passes. The canonical deploy dir is ~/mapmax (the compose project the
# platform reverse-proxy forwards 127.0.0.1:8087 to); we sync the checked-out
# tree there and (re)build, keeping the runner's work dir decoupled from the
# running stack. Health-checks the served files against disk so a stale image
# fails the deploy loudly instead of silently serving old code (#84).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD"
DEST="${DEPLOY_DIR:-$HOME/mapmax}"
PORT="${WEB_PORT:-8087}"

echo "::group::sync $SRC -> $DEST"
mkdir -p "$DEST"
# --delete keeps DEST an exact mirror; local-only secrets (never in the repo)
# are excluded from deletion so a checkout deploy can't wipe them.
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' --exclude='out' \
  --exclude='BUSINESS.md' --exclude='RULES.md' \
  "$SRC"/ "$DEST"/
echo "::endgroup::"

echo "::group::build + (re)start stack"
cd "$DEST"
# COPY layers bust on changed file checksums; --force-recreate guarantees the
# running containers are replaced by the freshly built images (a plain
# `up --build` can rebuild the image yet keep the old container).
WEB_PORT="$PORT" podman compose build web web-sandbox
WEB_PORT="$PORT" podman compose up -d --force-recreate edge web web-sandbox
echo "::endgroup::"

echo "::group::health check (served == disk)"
sleep 3
fail=0
for f in src/main.js src/config.js index.html; do
  served=$(curl -fsS "http://127.0.0.1:${PORT}/${f}" -H 'Host: www.mapmax.confinia.io' | md5sum | cut -d' ' -f1)
  disk=$(md5sum "$DEST/$f" | cut -d' ' -f1)
  if [ "$served" != "$disk" ]; then
    echo "STALE: $f served=$served disk=$disk" >&2
    fail=1
  else
    echo "ok: $f ($served)"
  fi
done
[ "$fail" -eq 0 ] || { echo "deploy FAILED — served content does not match the deployed tree" >&2; exit 1; }
echo "::endgroup::"

echo "deploy-confinia: live on 127.0.0.1:${PORT} — served content matches HEAD"
