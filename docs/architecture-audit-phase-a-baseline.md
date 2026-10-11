# Vivid Cinema Architecture Audit — Phase A Baseline

**Audit date:** 2026-10-11  
**Repository:** `sensorylog/vivid-cinema`  
**Baseline branch:** `main`  
**Baseline commit:** `36bda77486e4b502ebd17dc6349275fe4128e354`  
**Purpose:** establish an evidence-based inventory and safe change plan before repository cleanup. This document does not itself authorize broad file moves or behavior changes.

## Scope and limits

This is a source-tree and configuration review of the repository at the baseline commit. It includes repository layout, watch-page entry points, playback module boundaries, stylesheet loading, package scripts, CI workflows, Firebase Hosting configuration, and service-worker maintenance. A green workflow is not proof of successful playback in every browser/provider or proof that production Firebase configuration matches the repository.

No application files are moved, renamed, deleted, or rewritten in Phase A. Public page URLs and runtime behavior are treated as compatibility constraints.

## Baseline inventory

The recursive Git tree at the baseline contained 160 tracked files, including 30 root-level HTML pages, 35 files under `styles/`, and 49 JavaScript modules under `scripts/`. These are inventory counts, not a recommendation to move every file into a new directory.

### Existing boundaries to preserve

| Area | Current entry points / files | Phase A handling |
|---|---|---|
| Static public pages | Root-level `*.html`, including `watch.html` | Preserve public filenames and direct URLs |
| Watch-page orchestration | `scripts/watch.js`, `watch.html` | Do not refactor until dependencies and behavior are mapped |
| Player engine | `scripts/player-engine.js` | Preserve player lifecycle and event contracts |
| Provider URL builders | `scripts/playback-urls.js` | Preserve provider-specific URL construction |
| Built-in/custom server registry | `scripts/playback-servers.js`, `scripts/server-settings.js` | Preserve saved settings and fallback behavior |
| Secondary player | `scripts/tflix-secondary-player.js` | Keep isolated from primary-player state |
| Shared and watch styles | `styles/vivid-foundation.css`, `styles/vivid-system.css`, `styles/vivid-shell.css`, `styles/vivid-title.css`, `styles/vivid-pwa.css`, `styles/vivid-atmosphere.css`, `styles/vivid-audit-fixes.css`, `styles/vivid-search-standalone.css`, `styles/vivid-desktop.css`, `styles/vivid-liquid-glass.css`, `styles/vivid-watch.css`, `styles/vivid-cleanup.css`, `styles/vivid-watch-polish.css` | Record load order and page usage before consolidation |
| PWA caching | `service-worker.js`, `manifest.json` | Preserve lifecycle and offline behavior; test cache upgrades |
| Hosting and security headers | `firebase.json` | Keep deployment behavior stable; separately verify deployed headers |
| Firestore authorization | `firestore.rules`, `firestore.indexes.json` | No policy changes during structural cleanup |
| Tests and CI | `tests/`, `automation/`, `.github/workflows/` | Keep existing coverage while clarifying ownership |
| Documentation | `docs/` | Use as the home for architecture and release runbooks |

## Findings to investigate before cleanup

These are review items, not all confirmed defects.

### A1 — CSS ownership and cascade

The watch page loads multiple shared stylesheets followed by watch-specific styles and cleanup/polish overrides. Filenames such as `vivid-audit-fixes.css`, `vivid-cleanup.css`, `vivid-liquid-glass.css`, and `vivid-watch-polish.css` suggest layers whose scope and long-term ownership need to be documented. Names alone do not prove a file is redundant.

**Required evidence before deleting or merging CSS:** page-to-stylesheet map, duplicate-selector/rule review, visual comparison at mobile and desktop breakpoints, and a rollback-ready commit.

### A2 — Root directory and public URL stability

The project is a static site hosted with Firebase Hosting's public directory set to `.`. Moving root HTML pages or public assets can change URLs and relative references.

**Safe first move:** organize documentation and maintenance tooling only where Firebase Hosting ignores those paths; do not relocate public HTML, runtime assets, Firebase config, or service-worker entry points as part of a generic folder cleanup.

### A3 — Service-worker cache inventory

The service worker maintains an explicit shell asset list and a cache version. Cache entries and URL query variants must be checked against actual files and page imports before simplification.

**Required evidence:** asset-existence check, cache-upgrade test from an older version, offline fallback check, and confirmation that changed runtime assets become visible after deployment.

### A4 — Test command and dependency ownership

The root `package.json` defines `test`, `test:rules`, and `check:syntax`; `tests/package.json` separately defines emulator/test commands and dependency versions. CI also runs targeted tests directly in `.github/workflows/ci.yml`.

The root rules-test command references `tests/firestore.rules.test.mjs`, while the nested package script references `firestore-rules.test.mjs`. Verify the tracked filenames and intended canonical command before changing either script. The root and nested package manifests also pin different Firebase-related dependency ranges; this may be intentional, but should be documented and made reproducible.

**Do not consolidate workflows or dependency manifests until** every check has an identified owner and the resulting CI matrix demonstrably retains equivalent coverage.

### A5 — CI overlap versus complementary coverage

`ci.yml` performs syntax checks, several targeted tests, JSON validation, local import/reference checks, app-shell/service-worker checks, and a Firestore emulator job. `quality.yml` installs root dependencies and runs the package-level checks and rules tests. Some work overlaps, while other checks are unique.

**Action:** map each check to its purpose and trigger; remove only proven duplicate work. Keep pull-request validation comprehensive.

### A6 — Production checks are not fully automated

CI cannot by itself verify third-party playback availability, browser autoplay/fullscreen behavior, mobile layout, deployed Firestore rules, or the actual production response headers.

**Action:** retain explicit production verification for provider playback and Firebase Hosting/security configuration before release.

## Compatibility constraints

Every cleanup change must preserve, unless a separately reviewed bug fix explicitly changes it:

- Existing public page URLs, query-string routing, hash links, and direct links into movie/TV watch pages.
- Provider-specific playback URLs, server switching, fallback selection, resume/progress behavior, and TV season/episode navigation.
- Separation between the primary player and the TFLiX-inspired secondary player.
- Existing authentication, user library, and Firestore authorization behavior.
- Service-worker install/activate lifecycle, cache upgrade behavior, and offline fallback.
- Firebase Hosting rewrites/headers and all required third-party frame/connect permissions.
- Existing page entry-point initialization and stylesheet cascade ordering until tested replacements are ready.

## Risk register

| ID | Risk | Severity | Safe next action |
|---|---|---:|---|
| R1 | CSS removal changes layout or controls | High | Map page usage and compare before/after screenshots |
| R2 | Moving public files breaks direct URLs or relative assets | High | Keep public paths stable; add path checks before any move |
| R3 | Playback refactor breaks provider-specific behavior | High | Add focused contract tests before refactoring |
| R4 | Service-worker cache serves stale or missing assets | High | Add cache-entry and upgrade regression checks |
| R5 | Rules-test script/filename mismatch causes skipped or failing tests | High | Verify tracked filenames and run canonical commands |
| R6 | CI consolidation silently drops unique checks | Medium/High | Build a check-ownership matrix first |
| R7 | Dependency drift between root and tests causes inconsistent runs | Medium | Document ownership and lockfile strategy before changing versions |
| R8 | A source-level pass is mistaken for production verification | High | Track live-browser and deployed-config checks as separate release gates |

## Phase A exit criteria

Phase A is complete when:
1. This baseline inventory is reviewed and committed on an isolated branch.
2. The test-file/script discrepancy is checked against the tracked tree.
3. The current CI status and canonical test commands are recorded without claiming unrun tests passed.
4. A page-to-script/style/asset dependency inventory is ready before any file moves.

## Phases after A

- **B — Low-risk hygiene:** remove only confirmed dead references/artifacts and document module ownership; keep public paths and runtime behavior unchanged.
- **C — Controlled structural cleanup:** move one cohesive internal module group at a time, updating imports and tests in the same change.
- **D — Validation and hardening:** complete regression, cache-upgrade, browser/device, and production-configuration checks; document remaining risks.

Each phase should be a separate reviewable change. Do not merge a cleanup PR solely because CI is green if required browser or production checks have not been performed.
