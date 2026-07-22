# MapMax — Project Rules

Rules that every issue and pull request in this repository must follow.

## R1 — Tests per issue, run after each deployment

Each issue must expose a **unit test or end-to-end test**. These tests must then be
**run after each deployment**.

- Tests live in [tests/](tests/): `tests/unit/` (pure logic, no network) and
  `tests/e2e/` (against the deployed GitHub Pages site and the live upstream APIs).
- The PR that resolves an issue must add or extend at least one test referencing
  that issue.
- After every deployment (merge to `main` → GitHub Pages), run the full suite:

  ```sh
  deno task test          # unit + e2e against https://clement-igonet.github.io/mapmax/
  DEPLOY_URL=http://localhost:8000 deno task test:e2e   # against a local serve
  ```

- Phase 2 (once a token with `workflow` scope is available): the same suite runs
  in GitHub Actions automatically after each Pages deployment.

## R2 — Issue → PR workflow

Every expectation, improvement or bug is a GitHub Issue; every change lands
through a Pull Request referencing its issue (`Closes #N`). No feature work is
pushed directly to `main`.

## R3 — Front-end only

No backend, no database of ours. The app must remain deployable as static files
(GitHub Pages), consuming only public APIs (Panoramax, vector tiles).
