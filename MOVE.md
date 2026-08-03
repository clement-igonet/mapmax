# MOVE — MapMax off the `debian` user, onto the `mapmax` user

> **STATUS: APPLIED 2026-08-03.** The cleanup steps below were executed: the
> legacy snapshot is archived at `/home/debian/mapmax-legacy-snapshot-2026-08-03.tar.gz`
> and removed; all mapmax images under `debian` (incl. `mapmax_e2e`, spotted
> during cleanup) are deleted — `podman images | grep mapmax` under `debian` is
> empty. The optional global `podman image prune` was intentionally NOT run
> (danglings belong to many projects; strictly mapmax-scoped deletions only).
> Remaining: the repo follow-up below (deploy-confinia.sh comment).

Prepare/finish the move of everything MapMax from `/home/debian/projects/mapmax`
to `/home/mapmax/projects/mapmax` on the VM. Rule going forward: **SSH as
`mapmax` for all MapMax work; `debian` is reserved for sudo/admin actions.**

## Current state (verified 2026-08-03)

The move is already mostly done — the live stack and the CI runner both run
under `mapmax`:

| What | Where | Status |
|---|---|---|
| Live deploy dir | `/home/mapmax/projects/mapmax` | ✅ active (deployed by CI) |
| Stack service | `mapmax` user unit `mapmax-stack.service` (`~/.config/systemd/user/`), linger **on** | ✅ running (edge + web + web-staging + web-sandbox on `127.0.0.1:8087`) |
| Self-hosted runner (repo `clement-igonet/mapmax`, agent `cka-ovh-confinia`, label `confinia`) | `/home/mapmax/actions-runner` (user unit `actions-runner.service`, enabled) | ✅ running as `mapmax` |
| Platform runner (`confinia/confinia-core`) | `/home/debian/actions-runner` + system unit `actions.runner.confinia-confinia-core.confinia-vm.service` (`User=debian`) | ⛔ owner-managed — NOT ours, do not touch (R10 spirit) |

## Podman inventory (2026-08-03)

### `mapmax` user — keep everything

Images: `localhost/mapmax_web|web-staging|web-sandbox|e2e`, `localhost/mapmaxci_web|e2e`
(CI-gate project), bases `node:24-bookworm`, `node:20-bookworm`, `caddy:2-alpine`,
`deno:2.5.3`, `nginx:1.27-alpine`, `playwright:v1.47.2-jammy`, plus ~30 dangling
`<none>` layers (safe to `podman image prune` when disk matters).

Containers: `mapmax_web_1`, `mapmax_web-staging_1`, `mapmax_web-sandbox_1`,
`mapmax_edge_1` — the live stack.

Volumes: **none** (the site is stateless; nothing to migrate). ✅

### `debian` user — mapmax leftovers to remove

Everything mapmax-related under `debian` is legacy; **no mapmax volumes exist**
(all of `debian`'s volumes belong to other projects — platform, confinia,
ecobuilding, indoorequal, … — untouched).

| Leftover | Size | Action |
|---|---|---|
| `~/projects/mapmax` (stale deployed snapshot, pre-move) | 1.6 MB | archive then delete |
| image `localhost/mapmax_web:latest` | 51 MB | delete |
| image `localhost/mapmax_web-sandbox:latest` | 51 MB | delete |
| image `localhost/mapmaxci_web:latest` | 51 MB | delete |
| image `localhost/mapmaxci_e2e:latest` | 2.09 GB | delete |
| image `localhost/mapmax_e2e:latest` (found during cleanup) | 2.09 GB | delete |
| ~~`~/projects/mapmax-pr98` + `mapmax-pr98_*` images/containers~~ | ~2.1 GB | ✅ already removed (2026-08-03 — one-off PR-test run mistakenly made as `debian`) |

## Cleanup steps (run as `debian` — this is the sudo-tier exception)

```sh
# 1. Nothing mapmax runs under debian — verify (expect no output):
podman ps --format '{{.Names}}' | grep -i mapmax

# 2. Keep a one-shot archive of the legacy snapshot, then remove it:
tar czf ~/mapmax-legacy-snapshot-$(date +%F).tar.gz -C ~/projects mapmax
rm -rf ~/projects/mapmax

# 3. Remove the legacy mapmax images:
podman rmi localhost/mapmax_web:latest localhost/mapmax_web-sandbox:latest \
           localhost/mapmaxci_web:latest localhost/mapmaxci_e2e:latest

# 4. Optional disk hygiene (debian containers storage is 45 GB total — most of
#    it is OTHER projects; only prune danglings, never other projects' images):
podman image prune -f
```

## Repo follow-ups

- [ ] `scripts/deploy-confinia.sh` header comment still says the runner runs
      "as user `debian`" — outdated, now `mapmax` (comment-only fix).
- [ ] After cleanup, delete this section's checked items or the whole file.

## Invariants after the move

- The platform reverse-proxy still forwards to `127.0.0.1:8087` — the edge port
  is bound by the `mapmax` user's stack; **no platform Caddyfile change needed**
  (and none allowed, R10).
- Deploys: push to `main` → runner (as `mapmax`) runs `ci-test.sh` gate →
  `deploy-confinia.sh` rsyncs to `/home/mapmax/projects/mapmax` and restarts
  `mapmax-stack.service` (user unit, linger on).
- PR/branch test runs (e2e etc.) also happen as `mapmax` — e.g.
  `git clone -b <branch> … ~/projects/mapmax-pr<N> && podman compose build web e2e && podman compose up -d web && podman compose run --rm e2e`,
  then `podman compose down` and remove the clone.
