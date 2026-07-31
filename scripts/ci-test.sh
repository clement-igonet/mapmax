#!/usr/bin/env bash
# MapMax CI gate — unit tests + containerized e2e, run in an ISOLATED compose
# project so the live confinia stack (project `mapmax`) is never touched. Called
# by .github/workflows/deploy-confinia.yml on the self-hosted runner; also
# runnable by hand on the VM. Fails the build (non-zero exit) on any test
# failure, so a broken build never reaches the deploy step (#84).
set -euo pipefail
cd "$(dirname "$0")/.."

DENO_IMAGE="docker.io/denoland/deno:2.5.3"
PROJ="mapmaxci"   # isolated project — distinct container names + network

echo "::group::unit tests (deno)"
podman run --rm -v "$PWD":/app:Z -w /app "$DENO_IMAGE" \
  deno test --allow-read tests/unit/
echo "::endgroup::"

# Tear the isolated stack down no matter how we exit (pass, fail, or Ctrl-C) so
# a CI run never leaks containers/networks onto the VM.
cleanup() { podman-compose -p "$PROJ" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "::group::e2e (containerized Chromium vs a throwaway web)"
# No `edge` here: the e2e talks to `web` directly over the compose network, so
# we avoid publishing 127.0.0.1:8087 and never collide with the live edge.
podman-compose -p "$PROJ" build web e2e
podman-compose -p "$PROJ" up -d web
sleep 2
# The walk e2e (#5) fetches live Panoramax imagery and is timing-sensitive under
# swiftshader, so it flakes on a slow/cold network. Retry once so a transient
# flake never blocks a legitimate deploy; a genuinely broken build fails both
# attempts. --no-deps stops `run` from re-creating the already-up `web`.
e2e_ok=0
for attempt in 1 2; do
  echo "e2e attempt ${attempt}/2"
  if podman-compose -p "$PROJ" run --rm --no-deps -e E2E_SOFT_GL=1 e2e; then e2e_ok=1; break; fi
  echo "e2e attempt ${attempt} failed" >&2
done
[ "$e2e_ok" -eq 1 ] || { echo "e2e failed after 2 attempts" >&2; exit 1; }
echo "::endgroup::"

echo "ci-test: unit + e2e PASSED"
