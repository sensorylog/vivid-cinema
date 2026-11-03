# App loading and performance

This is a targeted performance pass. It keeps the current Electron + static web app + service-worker architecture, existing APIs, player, account flow, and offline behavior.

## What the audit found

- The Electron main process eagerly loaded WebTorrent/torrent-search, FFmpeg/FFprobe, and electron-updater before the first window was created. Those systems are not needed to display the Home page.
- The Home document loaded Google Fonts and Bootstrap Icons as render-blocking stylesheets, even though text/system-font fallbacks are usable for first paint.
- Ambient animation, the hero trailer module, and the PWA module were also started directly from Home. The app shell already schedules PWA registration and other background modules after the first frame, so the direct PWA import duplicated that work.

## Changes

- Download/torrent dependencies are now required and constructed only when a download-library IPC action first needs them.
- FFmpeg/FFprobe and the local HLS transcode server are loaded and started only when the user opens a local or downloaded video.
- electron-updater is loaded on the existing delayed update-check path, rather than during process startup. Update checks still begin on the existing schedule.
- The main process can emit opt-in startup timings with VIVID_PERF_DIAGNOSTICS=1 or the --vivid-perf command-line switch. The timings are local console diagnostics only; they do not collect or transmit user data.
- Home's font stylesheet, icon stylesheet, ambient effects, and trailer billboard are scheduled after the first animation frame and browser idle time. The text labels and system font fallbacks keep the page usable while those resources load.
- The deferred ambient-art module checks the already-rendered trending rail as well as listening for the normal trending event, so it does not miss data when it starts later.
- The service-worker shell cache is incremented whenever the new loader is added.

These choices follow Electron's official [performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance): measure first, defer expensive module loading, keep the main process responsive, and schedule low-priority renderer work during idle time.

## Measurement, not guesswork

Use the same device, network, account state, and cache state before and after a change. Compare cold start and warm start separately.

For the Windows app, collect the opt-in startup log and inspect these stages:
- Electron ready
- Local app server ready
- Window ready to show
- First local/hosted app document loaded

For the web renderer, use Chromium DevTools Performance and Network panels. Record:
- First Contentful Paint and Largest Contentful Paint
- Interaction to Next Paint and Cumulative Layout Shift
- Main-thread scripting and style/layout time
- Number and size of requests before the first useful screen
- Long tasks, memory use, and CPU while the Home page settles

Use Lighthouse/PageSpeed for hosted web-page comparisons and Electron DevTools for the packaged Windows app. Do not treat a synthetic score as proof that offline playback, account restore, or navigation still works; keep the functional regression suite and Windows packaging checks in the release gate.

## Guardrails

- Do not remove shelves, recommendation logic, account sync, trailer playback, icons, fonts, PWA registration, or offline functionality to improve a score.
- Do not preload the full catalogue or all poster images. Keep lazy images and near-viewport shelf loading.
- Do not shorten data-cache lifetimes or weaken cache validation just to reduce request counts.
- Do not disable security features, sandboxing, context isolation, update verification, or media validation.
- Keep visual enhancements; schedule them after first paint instead of deleting them.
- Any further CSS consolidation, font self-hosting, route-level code splitting, or cache-policy changes should be driven by recorded waterfall/profile data and visual/regression tests.
