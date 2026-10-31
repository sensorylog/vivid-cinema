# Vivid Cinema download integration plan

**Status:** Queue manager, account-scoped metadata persistence, OPFS browser direct-file adapter, Internet Archive public-domain/approved-CC catalogue resolver, web download queue UI and browser offline player are implemented on the feature branch. Real browser/CORS/quota validation remains pending. Native media-transfer adapters are intentionally deferred.
**Date:** 31 October 2026
**Reference source:** [Flickv4](https://github.com/sheeshcake/Flickv4), GPL-3.0, by Wendale Franz Dy.

## Goal

Add movie and TV-episode downloads to Vivid Cinema itself. The existing `downloads.html` page remains the installer-download page; the in-app media library will be a separate feature.

## Existing Vivid architecture (verified on main)

- Static HTML/CSS/ES modules; `scripts/watch.js` owns the watch page.
- `scripts/playback/player-engine.js` supports authorized direct HLS, DASH and file playback. Its direct resolver is intentionally disabled until a resolver and exact HTTPS host allowlist are configured.
- `scripts/playback/direct-stream-validation.js` validates direct stream URLs against that allowlist.
- `capacitor.config.json` packages the web app for Android with Capacitor.
- `desktop/main.cjs` runs the Electron desktop shell and a local HTTP server.
- `service-worker.js` caches the app shell; it is not a media download engine or a proxy for third-party streams.
- Existing `downloads.html`, `scripts/downloads.js` and `styles/downloads.css` download Vivid's application installers, not movie files.

## Reusable Flickv4 concepts

Review and adapt concepts from these source files; do not copy React Native-only imports into Vivid's browser modules:

- `src/services/DownloadService.ts`: job model, queue lifecycle, direct-file and HLS download orchestration, progress and resume state.
- `src/hooks/useDownloads.tsx`: observable download state.
- `src/screens/DownloadsScreen.tsx`: grouping movies and episodes and displaying status.
- `src/utils/hlsVariants.ts`: HLS master-playlist and variant concepts.
- `src/components/DownloadQualitySheet.tsx`: quality selection UX.

The Expo/React Native downloader, AsyncStorage, Notifee and native filesystem APIs are not drop-in dependencies for Vivid.

## Implemented foundation (31 October 2026)

- Added `scripts/downloads/download-manager.js`, a platform-neutral queue/state manager.
- Added `tests/download-manager.test.mjs` for identity validation, duplicate prevention, TV episode identity, interrupted-job recovery, adapter failure/retry, cancellation and asset removal.
- Added the queue and IndexedDB persistence test files to the `npm test` script.
- Added `scripts/downloads/indexeddb-persistence.js`, an IndexedDB metadata store explicitly scoped to a guest or authenticated owner ID. Separate owners cannot read each other's job lists. It stores job metadata only, not media blobs or provider URLs.
- Added `scripts/downloads/browser-direct-adapter.js`, which accepts only resolver-supplied HTTPS URLs on an explicit host allowlist, rejects redirects and non-video responses, streams direct video files into OPFS, reports byte progress, enforces a configurable size limit and cleans partial output on failure. It exposes local-file access/removal methods for later player integration.
- Corrected cancellation ordering so the manager waits for the transfer adapter to settle before asking it to remove partial output.
- The manager receives persistence and download adapters by dependency injection. It does not resolve media URLs, fetch media, write files, or claim offline playback. Persisted job metadata intentionally excludes source URLs and provider credentials.
- Added `my-downloads.html`, `scripts/my-downloads.js` and `styles/my-downloads.css` as a distinct offline-library route; the installer page remains unchanged. The shared desktop/mobile navigation links to the new page and the service worker precaches its shell assets.
- The library hydrates account/guest-scoped IndexedDB metadata, searches Internet Archive movie items, inspects item metadata and eligible video files, and exposes downloads only when a supported public-domain or Creative Commons license declaration is present. The browser OPFS adapter is connected to the queue and local offline player; pause, retry, cancel, remove and play are wired. This source is a test catalogue, not a general current-movie/TV provider.
- The Internet Archive source only supports movie catalogue items and direct video files (MP4, M4V, WebM, MOV and OGV). It does not provide a general TV-series episode catalogue. Items without an approved license declaration are blocked, but item-level rights metadata is uploader-supplied and still requires human review. The adapter does not support HLS/DASH. OPFS availability, CORS policy, storage quota and browser lifecycle vary; background-download guarantees are not made.

## Proposed Vivid design

1. **Shared web contract** — a platform-neutral download manager owns jobs, validation, queue state, progress events, cancellation, retry and metadata. Persist metadata separately from media bytes.
2. **Authorized source resolver** — the first web test source is Internet Archive, using its official Advanced Search and Item Metadata APIs. The resolver accepts only supported public-domain/CC declarations and direct video files hosted on archive.org subdomains. Do not infer download URLs from an iframe or scrape a third-party player.
3. **Platform adapters**
   - Browser/PWA: user-initiated downloads for supported direct files; clearly communicate browser limitations. Do not promise durable background HLS downloads or offline availability where the browser cannot guarantee it.
   - Capacitor Android: native filesystem/download adapter with app-private storage, lifecycle-safe progress, storage checks and Android-compatible playback URIs.
   - Electron: main-process download handler with a user-selected or app-managed media directory, safe IPC, progress events and local-file playback.
4. **Offline library** — a distinct in-app page showing movies and grouped TV episodes, artwork/metadata, quality, size, status, play, retry and delete actions.
5. **Offline playback** — route completed local files or locally rewritten HLS playlists through a dedicated local-media player path; never send a local URI to an external iframe.
6. **Lifecycle and safety** — persist queue metadata, recover interrupted jobs, handle expiring URLs and partial files, verify completed assets, enforce disk-space limits, and provide explicit delete controls.

## Required safeguards

- No CAPTCHA, DRM, paywall or access-control bypass.
- No scraping of embed players or third-party sites to discover unauthorized media downloads.
- A software license or a developer's permission to reuse code does not grant rights to download, store or redistribute movies and TV episodes. Each media source must separately authorize downloads and offline storage.
- Never put provider secrets or signing keys in client-side code.

## Implementation sequence

1. Complete this architecture and dependency audit.
2. Define the resolver and platform-adapter interfaces with tests and no live media provider.
3. Implement and test the job store/queue and browser-safe direct-file adapter.
4. Add Capacitor Android and Electron adapters independently.
5. Connect the browser adapter to the Internet Archive resolver and route completed OPFS files into offline playback (implemented on this feature branch).
6. Connect only an authorized source and test movie, TV episode, pause/resume, app restart, low storage, expired URL and deletion on real devices.

## Acceptance criteria

- A download job survives app restart on supported native platforms.
- Progress and failures are visible and actionable.
- A completed item plays without a network connection.
- Movies and TV episodes are correctly grouped and identified.
- The same web UI works without importing React Native packages.
- Tests cover queue transitions, persistence, URL validation, partial-file cleanup and offline playback routing.
