# Vivid Cinema Windows — Phase 1 Foundation Baseline

**Audit date:** 2026-11-01  
**Project scope:** Windows desktop application only  
**Application version at baseline:** 1.0.33  
**Repository:** `sensorylog/vivid-cinema`  
**Default branch:** `main`  
**Baseline commit:** `54beebd921e49a9135e5ba783f34f5011d3a8652`  
**Protected working branch:** `phase-1/windows-foundation-safety`

## Purpose and change policy

This document records the known Windows desktop baseline before the Vivid Ultra Player and Offline & Downloads upgrades.

The Phase 1 rule is conservative:

- Preserve the existing downloader, download records, downloaded media and playback-progress data.
- Do not rewrite working subsystems for architectural neatness.
- Change runtime code only when a specific, verified requirement cannot be met otherwise.
- If a proposed change has material regression or data-loss risk and is not essential, defer it.
- Do not merge or publish an upgrade until its tests and release checks pass.

The protected branch was created from the exact baseline commit above. It is a source-control recovery point; it does not back up media files or user data stored on individual Windows devices.

## Windows application architecture

| Area | Current implementation |
|---|---|
| Desktop shell | Electron |
| Main process | `desktop/main.cjs` |
| Renderer bridge | `desktop/preload.cjs` |
| Download engine | `desktop/download-engine.cjs` |
| Torrent client | WebTorrent 1.9.7 |
| Torrent search | torrent-search-api |
| Offline page | `my-downloads.html` |
| Desktop download UI | `scripts/downloads/desktop-offline.js` |
| Shared downloads page controller | `scripts/my-downloads.js` |
| Offline page styles | `styles/my-downloads.css` |
| Local media transport | `vivid-media` protocol with byte-range support |
| Desktop packaging | electron-builder, NSIS installer and portable target |
| Root app version | 1.0.33 |
| Desktop subpackage metadata | Legacy Dolphin Movie Downloader identity/version 1.1.3 |

Electron security foundations observed in the main/preload implementation include context isolation, disabled renderer Node integration, a sandboxed renderer, and a constrained preload API. Preserve these boundaries during future work.

## Existing downloader behaviour to preserve

The desktop engine currently owns torrent search/download lifecycle and persistence. The inspected implementation includes:

- WebTorrent client and torrent-search integration.
- Seven fallback tracker URLs.
- Persistent download/job records.
- Per-download progress and status reporting.
- Pause/resume handling implemented by destroying and reattaching the torrent while retaining saved data.
- Cancellation handling that removes the cancelled job record and targets its own partial-download directory.
- Completed video-file discovery using a configured video-extension list.
- Playback-position persistence keyed by download and file index.
- IPC methods exposed through the preload bridge for search, start, list, media URL, playback positions, folder selection and download control.

**Do not refactor these paths as part of a player or visual redesign.** First prove any required change with a reproducible test and preserve existing data formats and IPC contracts wherever possible.

## User data locations and protection boundary

The desktop engine currently resolves two important locations through Electron:

- Media files: `app.getPath("downloads")/Vivid Cinema` (the Windows user's Downloads folder, in a Vivid Cinema subfolder).
- Download state and playback positions: `app.getPath("userData")/vivid-downloads.json` (the Electron application user-data directory).

The JSON state currently contains a version field, the selected download path, job records and playback positions. Persistence writes to a temporary `.tmp` file and renames it into place.

Before any future migration or packaging change, both the media directory and the state JSON must be accounted for in a recovery plan. A Git branch protects source code only; it does not back up files on the user's PC. Never assume the Windows user-data path from a guessed product name—resolve and verify the actual path on the target installation before any data operation.

## Existing player behaviour

The Windows player currently uses Chromium HTML5 video through the Electron renderer and local `vivid-media` URLs.

Observed capabilities include local downloaded playback, play/pause, timeline/time display, volume, playback speed, keyboard seeking, fullscreen and saved playback position.

The player does not currently provide a complete dedicated subtitle/audio-track interface, visible 10-second skip buttons, timeline thumbnails, or a complete next-episode experience.

Chromium media support depends on the exact container/codec/audio combination. A filename extension or resolution label alone does not prove that a file will decode.

## Existing Offline & Downloads page

The current page provides search/quality selection, series season and episode selection, job status/progress, completed downloads, playback, folder access and download controls.

The UI also exposes some technical torrent diagnostics. Future UI work should simplify what ordinary users see while preserving useful diagnostics internally.

Visual changes must not change download-selection semantics, persistence, cancellation, storage paths or playback-data ownership unless a separately tested requirement proves this necessary.

## Existing tests and their actual scope

The root `npm test` script includes the repository test suite, including:

- `tests/desktop-build.test.mjs`
- `tests/desktop-download-engine.integration.test.cjs` (run separately by the Windows workflow)
- `tests/offline-playback.test.mjs`
- Browser downloads and IndexedDB tests.

The desktop build contract tests inspect packaging configuration, Windows targets, security/entry-point contracts, updater wiring, runtime dependency packaging and recovery-related structure.

The desktop download integration test uses a local seeded torrent and checks a small generated video-extension payload plus cancellation of a paused download and partial-file cleanup. The payload is not a real encoded movie; this test proves transfer/storage behaviour, not video decoding.

The `offline-playback.test.mjs` tests the browser/OPFS offline playback controller. It is not an end-to-end test of the Windows Electron desktop player's codec, subtitle or audio-track support.

### Known test coverage gaps

- No demonstrated real-media codec compatibility matrix for the Windows player.
- No demonstrated end-to-end Windows subtitle/audio-track selection tests.
- No demonstrated Windows GPU/hardware-decoding performance matrix.
- No demonstrated clean-machine manual install/launch test in the inspected workflow result.
- Downloader pause/resume/restart recovery and varied multi-file torrent cases need explicit verification.
- Full Windows player journey (download → library → play → save progress → relaunch → resume) needs a dedicated integration/manual test.

These are documented gaps, not assumptions that existing features are broken. Do not fill them by adding risky runtime changes in Phase 1.

## Windows build and CI baseline

At the baseline commit, the following GitHub Actions runs were observed:

- Windows desktop workflow: run `41254945112` — successful.
- Tests workflow: run `41254945136` — successful.
- Quality checks workflow: run `41254945264` — successful.

The Windows workflow ran desktop packaging contract tests, JavaScript syntax checks, repository regression tests and the local seeded-torrent integration test. Its release path built and verified the Windows release files and updater metadata and published the expected release assets.

The workflow's ordinary `Build Windows installer and portable executable` step was skipped on that run because the release-publishing path was selected instead; the alternate release-build/publish path completed successfully. A successful workflow is useful CI evidence, but it is not a substitute for a clean Windows machine installation and playback test.

A separate `Vivid Cinema reminders` workflow run `41260089136` failed at its reminder-sending step. It is not the Windows desktop build, test or quality-check workflow and is not evidence of a Windows application failure.

## Packaging and dependency caution

The root `package.json` is the active Vivid Cinema Windows packaging configuration. It defines the Vivid app ID, product name, output directory, x64 NSIS and portable targets, and the desktop build scripts.

The `desktop/package.json` still contains legacy Dolphin Movie Downloader identity and packaging metadata, while the Windows workflow installs its runtime dependencies from that subpackage. This arrangement is existing technical debt, but it is currently part of the working build path.

**Do not rename, consolidate, delete or migrate the desktop subpackage as cleanup during this upgrade.** Any future change here requires a specific dependency/packaging analysis and a Windows build proof.

## Phase 1 safety checklist

- [x] Confirm the repository and current default branch.
- [x] Record the exact baseline commit and version.
- [x] Create a protected working branch from the exact baseline commit.
- [x] Inventory the Windows runtime, downloader, player, Offline page and packaging paths.
- [x] Record successful baseline Windows, test and quality workflow runs.
- [x] Identify what the existing tests prove and what they do not prove.
- [x] Record high-risk legacy packaging/dependency areas to avoid touching casually.
- [x] Make no runtime-code, dependency, lockfile, download-data or release changes.
- [ ] Run a fresh full Windows workflow on the protected branch before any runtime implementation, if/when an approved workflow-dispatch or PR validation path is used.
- [ ] Perform manual Windows machine checks with representative downloaded media before selecting or replacing a playback engine.

## Phase 1 disposition

**Foundation inventory and source-control checkpoint: complete.**

**Runtime modifications: none.**

The remaining validation items above are intentionally retained as gates before risky implementation. The existing baseline CI is recorded, but no claim is made that physical Windows playback, codec compatibility, hardware decoding or clean-machine installation has been tested by this source audit.
