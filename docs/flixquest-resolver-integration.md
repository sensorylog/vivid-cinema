# FlixQuest resolver integration

**Status:** API v2 client and contract tests added. The public OpenAPI contract documents provider discovery and playback stream resolution, not an offline-download endpoint. The client deliberately exposes download options only if the API response explicitly supplies a direct `downloadUrl`/`download_url`, an affirmative `offlineDownload`/`offline_download` flag, and a direct video MIME type. Ordinary playback URLs, HLS/DASH manifests and stream-size estimates are never promoted to downloads.

## Configuration

Create the client with a verified HTTPS base URL:

```js
import { createFlixQuestApi } from "./flixquest-api.js";

const flixQuest = createFlixQuestApi({
  baseUrl: "https://YOUR-VERIFIED-FLIXQUEST-HOST"
});
```

The client appends `/api/v2` unless it is already present. It uses the documented GET paths `/providers`, `/providers/status`, `/stream-movie` and `/stream-tv`; it sends no cookies, rejects redirects and supports abort signals. Configure the host only after confirming the service owner authorizes your integration and the instance is live.

## Host candidates discovered in the public FlixQuest repository

- `https://scraper-1.flixquest.app`
- `https://scraper-2.flixquest.app`

These appear in repository configuration/migration documentation; they are not confirmed live instances or a grant of API access. The OpenAPI `servers` entry itself points only to local development. The FlixQuest README says the scraper backend is closed-source and directs integrators to `flixquestapp@gmail.com` for API access/support.

## Still required for real offline downloads

The public API contract returns playback streams and a stream-size estimate. It does not document offline-download authorization, direct file download URLs, durable link renewal, or an offline storage entitlement. Until the service returns the explicit offline fields described above (or provides a separate documented download endpoint), `getDownloadOptions` correctly returns no options. Do not pass a stream URL to the OPFS adapter merely because it plays.

The Vivid browser adapter currently supports direct video files only. HLS/DASH offline packaging, Android native storage, Electron main-process downloads, and end-to-end browser testing remain separate work. Do not claim the feature is complete until a permitted real movie and TV episode have been downloaded and played offline after network disconnection.


## Deeper GitHub implementation audit (2026-10-31)

The public FlixQuest and Flickv4 repositories provide useful implementation references, but neither supplies a verified public movie-download service that Vivid can simply switch on.

### FlixQuest native implementation

Audited public files:

- `android/app/src/main/kotlin/dev/beamlak/flixquest_v2/downloads/StreamDownloadStore.kt`
- `.../StreamDownloadService.kt`
- `.../StreamDownloadsBridge.kt`
- `.../DownloadSourceResolver.kt`
- `.../DownloadRecovery.kt`
- `.../DownloadTrackIdentity.kt`
- `lib/services/offline_download_service.dart`
- `docs/download_link_recovery.md`

The implementation uses AndroidX Media3's persistent `DownloadManager`, `DownloadService`, `SimpleCache`, and format-specific HLS, DASH and progressive downloaders. It prepares adaptive tracks before enqueueing, persists download metadata, exposes progress/actions over Flutter MethodChannel/EventChannel, and records selected audio/video track identity.

Its recovery design is particularly useful: it retries the existing URL first; only a positively identified expired signed URL can trigger bounded renewal; the renewed result must match the original provider, server, quality and format; selected track identities are restored rather than silently switching language/quality; refreshed requests are checkpointed. Generic HTTP failures and connectivity errors do not trigger a new scrape.

Important limitation: its renewal calls the same playback endpoints (`/stream-movie` and `/stream-tv`). It does not add a public download endpoint or prove that the returned third-party stream is licensed for offline storage. Its own recovery document says production-provider/device validation remains outstanding; the described HTTP fixtures use synthetic HLS media.

### Flickv4 native/Expo implementation

Audited public files:

- `src/services/DownloadService.ts`
- `src/components/DownloadResolverHost.tsx`
- `src/services/FlixQuestService.ts`
- `src/utils/hlsVariants.ts`
- `src/screens/DetailScreen.tsx`
- `src/config/env.ts`

The public client implements a persisted queue and HLS segment/playlist storage using Expo FileSystem, plus direct-file downloads, retries, pause/resume, local HLS playback and a resolver registration host. Its FlixQuest service resolves playback URLs from the v2 API. The resolver host uses the FlixQuest/Streamflix APIs for those configured servers and mounts a WebView scraper for other resolver types.

The README explicitly says the web-scraping engine lives in a private repository. Therefore the public repo is a downloader/client reference, not a complete source backend. Vivid must not depend on that private scraper or reproduce anti-bot, CAPTCHA, cookie extraction, DRM or access-control bypass behavior.

### Vivid's current implementation boundary

- `scripts/downloads/browser-hls-adapter.js` already has an OPFS HLS VOD path, segment storage, playlist rewriting, cancellation and host allowlisting. It deliberately rejects encrypted HLS, live playlists, byte ranges and unsupported alternate audio/subtitle structures.
- The adapter requires the resolver to return `offlineAllowed: true`. This is intentional. The current public FlixQuest OpenAPI does not document that field or an equivalent offline entitlement.
- `scripts/my-downloads.js` still depends on an injected `globalThis.VIVID_DOWNLOADS.resolve`; without a configured authorized resolver, the queue cannot obtain a source.
- The repository has `capacitor.config.json`, but no tracked `android/` project in the current default branch. A native Media3 implementation should therefore be delivered as a maintained local Capacitor plugin/package (or after intentionally adding the native platform project), not as edits to generated files that are absent from source control.

### Licensing constraint

Vivid Cinema's repository is MIT-licensed. The audited FlixQuest and Flickv4 repositories are GPL-3.0. Do not copy their implementation files into Vivid's MIT codebase as a shortcut. Use independently written code against AndroidX Media3 (Apache-2.0) and preserve third-party notices for any dependencies. If a direct code port is ever proposed, resolve the licensing/distribution implications first.

### Recommended implementation path

1. Keep the title-page click fix and the browser HLS engine as separate layers.
2. Obtain a verified FlixQuest API base URL and written service-owner confirmation of the permitted integration. Ask specifically whether offline storage is permitted and whether they can expose a documented offline-download flag/URL or separate endpoint. The README identifies the scraper backend as closed-source and directs API-access requests to `flixquestapp@gmail.com`.
3. Until that contract exists, keep playback URLs out of the download queue. Do not translate `links[].url`, `isM3U8`, `requiresProxy`, `sizeToken`, or `/stream-size` into an offline entitlement.
4. For assets Vivid owns or is licensed to store, implement a separate authorized source adapter that returns an explicit offline permission, a short-lived HTTPS URL, MIME type, expiry and required headers. The existing browser adapter can then download supported HLS VOD; the direct adapter can handle permitted direct files.
5. For Android background downloads of those authorized assets, independently implement a local Capacitor plugin around Media3 `DownloadService`/`DownloadManager` and `DownloadHelper`. Persist the Media3 download index/cache, expose enqueue/pause/resume/remove/progress, and verify offline playback after force-stop and network disconnection.
6. Do not mark the feature complete until a known-permitted movie and TV episode both download, survive app restart, and play with networking disabled.

### Audited public references

- FlixQuest app: https://github.com/flixquest/flixquest
- FlixQuest API contract: https://github.com/flixquest/flixquest/blob/main/openapi.json
- FlixQuest recovery design: https://github.com/flixquest/flixquest/blob/main/docs/download_link_recovery.md
- Flickv4: https://github.com/sheeshcake/Flickv4
- AndroidX Media3 downloads: https://developer.android.com/media/media3/exoplayer/downloading-media
