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
cleanup() { podman compose -p "$PROJ" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "::group::e2e (containerized Chromium vs a throwaway web)"
# No `edge` here: the e2e talks to `web` directly over the compose network, so
# we avoid publishing 127.0.0.1:8087 and never collide with the live edge.
podman compose -p "$PROJ" build web e2e
podman compose -p "$PROJ" up -d web
# web is already up; --no-deps stops `run` from re-creating it (name clash).
sleep 2
podman compose -p "$PROJ" run --rm --no-deps e2e
echo "::endgroup::"

echo "ci-test: unit + e2e PASSED"
