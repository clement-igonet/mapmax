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
DEST="${DEPLOY_DIR:-$HOME/projects/mapmax}"
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

echo "::group::build + restart stack (systemd-managed)"
cd "$DEST"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
WEB_PORT="$PORT" podman-compose build web web-staging web-sandbox
# The stack runs as a persistent systemd user service (mapmax-stack.service, on
# the VM) so the rootless port-forwarder is owned by SYSTEMD, not this deploy job.
# `podman-compose up -d` from a CI job/SSH leaves the forwarder in the caller's
# cgroup, so it's killed when the job ends → post-deploy 502s (#90). Restarting
# the service re-ups with the freshly built images (its ExecStartPre downs first)
# and keeps the forwarder alive across the job. Restart=always is the auto-heal,
# so no separate watchdog is needed.
systemctl --user restart mapmax-stack.service
# Wait for the edge to actually serve before health-checking.
for _ in $(seq 1 30); do
  curl -sf --max-time 4 -o /dev/null "http://127.0.0.1:${PORT}/" -H 'Host: www.mapmax.confinia.io' && break || sleep 2
done
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
