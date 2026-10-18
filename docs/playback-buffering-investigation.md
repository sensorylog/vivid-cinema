# Playback buffering investigation and safe integration path

## What this patch changes

The direct-stream player now accepts an optional `onDiagnostics(sample)` callback. When an authorized direct stream is active, it reports native media events (`waiting`, `stalled`, `playing`, `error`, and related load/progress events), current playback time, seconds buffered ahead, browser ready/network states, and the media error code. It deliberately does not include the media URL, title, user identity, or network identifiers. Callback exceptions are swallowed so diagnostics cannot break playback. Listeners are removed when the direct player is disposed.

This is opt-in instrumentation only: no automatic server switching, quality changes, retries, or changes to existing iframe providers are made. It will not diagnose buffering inside cross-origin provider iframes because browser same-origin rules prevent the parent page from observing their internal media element events. The existing iframe server flow remains unchanged.

## Direct stream reality check

A legitimate direct-stream engine is already present, but it is intentionally disabled until a trusted resolver and explicit HTTPS host allowlist are configured in `scripts/config.js`. Do not point it at scraped stream URLs, provider internals, DRM-protected manifests, or sources whose rights are unclear. A free, reliable direct stream for arbitrary commercial films is not something a front-end can conjure up: the catalog needs a provider that is authorized to serve each title and permits direct playback/CORS.

A viable no-cost *test source* is a clearly licensed/public-domain video with a stable MP4 or HLS manifest, hosted by its rights holder or a trusted archive. Internet Archive exposes item metadata through `https://archive.org/metadata/{identifier}`, but it warns that user-supplied rights labels are not guaranteed; verify each title and license before enabling it. An archive test source proves the player engine works, not that it can legally provide current commercial catalog titles.

## Safe rollout

1. Keep this change on a separate branch and review the pull request before merging.
2. Test a known, authorized MP4/HLS/DASH source on desktop Chrome and iOS Safari. Pass `onDiagnostics: sample => console.info("[Vivid playback]", sample)` only during local testing; do not log stream URLs or user data.
3. Compare `waiting`/`stalled` events and `bufferedAhead` on the same title, network, and device. If only the iframe player buffers, the fault is likely within its upstream player/source/network path and cannot be fixed by the parent page's video-element controls.
4. Only configure `directStreamHosts` and `VIVID_DIRECT_STREAM_RESOLVER` after verifying authorization, URL stability, CORS/range support, and license terms. Preserve the existing iframe sources as fallback.

## Verification status

The change has source-level tests added. They still need to be run in a checked-out environment, followed by real-device playback testing. No claim is made that this patch fixes upstream iframe buffering by itself.
