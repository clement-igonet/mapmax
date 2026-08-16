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
# 1PESI band (platform PR #10): health-check through the new home port.
PORT="${WEB_PORT:-14000}"
TARGET="${DEPLOY_TARGET:-all}"

health_check() { # $1 = vhost, $2 = tree the served files must match, $3 = port (default $PORT)
  local host="$1" tree="$2" port="${3:-$PORT}" fail=0 served disk
  for _ in $(seq 1 30); do
    curl -sf --max-time 4 -o /dev/null "http://127.0.0.1:${port}/" -H "Host: ${host}" && break || sleep 2
  done
  sleep 3
  for f in src/main.js src/config.js index.html; do
    served=$(curl -fsS "http://127.0.0.1:${port}/${f}" -H "Host: ${host}" | md5sum | cut -d' ' -f1)
    disk=$(md5sum "$tree/$f" | cut -d' ' -f1)
    if [ "$served" != "$disk" ]; then
      echo "STALE: $f served=$served disk=$disk" >&2
      fail=1
    else
      echo "ok: $f ($served)"
    fi
  done
  [ "$fail" -eq 0 ] || { echo "deploy FAILED — ${host} on :${port} does not serve the deployed tree" >&2; exit 1; }
}

# A port that is expected to serve, but only once the systemd unit has been
# updated to start its container — report, never fail the deploy on it.
soft_port_check() { # $1 = vhost, $2 = port, $3 = what
  if curl -sf --max-time 4 -o /dev/null "http://127.0.0.1:${2}/" -H "Host: ${1}"; then
    echo "ok: ${3} answering on :${2}"
  else
    echo "note: ${3} not yet listening on :${2} (expected until the stack unit starts it)"
  fi
}

# Sandbox-only branch deploy (R14): build the sandbox image straight from THIS
# checkout — the canonical deploy dir (www/staging's tree) is never touched, so
# a branch can never leak into production. `-p mapmax` keeps the image name the
# systemd stack expects (mapmax_web-sandbox).
if [ "$TARGET" = "sandbox" ]; then
  echo "::group::sandbox-only deploy from $SRC"
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  podman-compose -p mapmax build web-sandbox
  systemctl --user restart mapmax-stack.service
  echo "::endgroup::"
  echo "::group::health check (sandbox serves this branch)"
  health_check "sandbox.mapmax.confinia.io" "$SRC"
  echo "::endgroup::"
  echo "deploy-confinia: sandbox live from branch checkout — www/staging untouched"
  exit 0
fi

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
echo "::endgroup::"

echo "::group::health check (served == disk)"
health_check "www.mapmax.confinia.io" "$DEST"
# 1PESI split (staging 14300, sandbox 14400) — dual-published alongside 14000.
soft_port_check "staging.mapmax.confinia.io" "${STAGING_PORT:-14300}" "staging edge"
soft_port_check "sandbox.mapmax.confinia.io" "${SANDBOX_PORT:-14400}" "sandbox edge"
echo "::endgroup::"

echo "deploy-confinia: live on 127.0.0.1:${PORT} — served content matches HEAD"
