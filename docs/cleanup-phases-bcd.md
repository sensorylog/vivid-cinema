# Repository Cleanup Execution Record — Phases B–D

**Branch:** `chore/phase-a-architecture-inventory`  
**Pull request:** [#187 — organize playback modules and audit repository structure](https://github.com/sensorylog/vivid-cinema/pull/187)  
**Base commit:** `36bda77486e4b502ebd17dc6349275fe4128e354`

## Phase B — Low-risk hygiene

- Removed one duplicate `https://vidking.net` origin from the Firebase Hosting CSP `frame-src` directive.
- The same origin remains allowed; `https://www.vidking.net` remains a separate permitted host.
- No Firebase rules, indexes, page URLs, or hosting routes were changed.

## Phase C — Controlled structure cleanup

Moved these six modules from `scripts/` to `scripts/playback/`:

- `player-engine.js`
- `playback-urls.js`
- `playback-servers.js`
- `server-settings.js`
- `tflix-secondary-player.js`
- `direct-stream-validation.js`

Updated the watch-page imports, internal imports, test source paths, service-worker precache entries, and the scoped syntax-check list. The original root-level module files are removed on this branch; the public HTML entry points remain where they were.

No provider URL logic or player behavior was intentionally rewritten as part of the move.

## Phase D — Automated regression protection

- Added `tests/playback-structure.test.mjs`, which asserts that the six modules stay in `scripts/playback/`, the old paths remain absent, the watch controller imports the new locations, and the service worker references the new precache paths.
- Added the structural test to the root `npm test` command.
- Updated `automation/check-syntax.mjs` to check the relocated playback modules and include direct-stream validation.

## Verification status

- Repository tree inspection confirms the six new paths exist and the old root paths are absent.
- The `Vivid Cinema CI` static-validation job passed on an earlier complete structural-migration commit.
- The latest full CI and Quality checks are being run against the current head; their final results must be checked before this PR is marked ready.
- Real-browser/device playback, service-worker upgrade from an already cached release, and verification of deployed Firebase rules/Hosting headers have not been performed by this source-only change. These remain production release gates.

## Explicit non-goals

This cleanup does not consolidate stylesheets, migrate the static site to a framework, reorganize public HTML routes, merge the two Firestore test suites, change dependency versions, or alter playback-provider URLs. Those require separate evidence and review.
