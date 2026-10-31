# Offline video provider research and Flickv4 technical audit

Research snapshot: 2026-10-31. This is an implementation-oriented comparison, not a claim that any third-party service grants Vivid rights to download arbitrary catalog titles.

## Executive finding

There is no verified universal public API in the reviewed sources that resolves arbitrary TMDB movies/episodes to downloadable MP4s with offline-storage rights. FlixQuest Scraper API v2 is a playback-source resolver. Its published OpenAPI contract exposes provider discovery/health, movie/TV stream resolution, subtitles and stream-size estimation; it does not publish a download endpoint or offline entitlement. A stream-size estimate is not a download grant.

Keep two provider classes separate:

1. **Catalog resolver**: maps a TMDB movie/episode to a stream. It must explicitly document a direct-download operation and the right to store the returned asset offline before Vivid can treat it as a download source.
2. **Content-owner video API**: creates downloadable renditions of videos uploaded/owned by the API account. These APIs are technically clean, but are not substitutes for a general movie catalog resolver.

## Provider matrix

| Provider/API | What the official docs support | Offline capability | Fit for Vivid catalog downloads |
|---|---|---|---|
| FlixQuest Scraper API v2 | Enabled providers, health, movie/TV stream links, subtitles, stream-size estimate | No public offline-download endpoint or offline permission field in published OpenAPI | Best existing resolver candidate, but blocked on service access and an explicit download contract |
| Cloudflare Stream | Owner uploads, HLS/DASH playback, generated MP4/M4A download, readiness polling, signed downloadable tokens | Explicit MP4 generation and signed-token downloadable=true | Excellent for Vivid-owned/licensed assets hosted in Vivid's Cloudflare account; not a third-party TMDB resolver |
| Mux Video | Owner-uploaded assets, static MP4 renditions, rendition readiness/status, signed playback policies | Static MP4 renditions for offline viewing; webhook/status lifecycle | Excellent for Vivid-owned/licensed assets; not an arbitrary movie/TV source |
| Vimeo API | Authenticated account video file/download fields with public, private, video_files scopes; CDN redirect URLs expire | Yes, for videos accessible to the authorized Vimeo account and plan | Good for a creator/library integration; not a universal catalog source |
| Dailymotion API | Partner-only downloadable stream URLs; Edge plan add-on and private API key permission required | Yes, for partner-owned/managed content under the account plan | Possible owner-content adapter; not a general catalog resolver |
| PeerTube | Federated video search/API, public web video files, private files with auth/token, generated MP4 mux endpoint | Yes, when the instance/video permits access and provides file IDs/tokens | Potential separate open-video/creator-content catalog; no reliable TMDB movie/episode mapping |
| YouTube Data API | Metadata and embedded playback, subject to YouTube API policies | API policy prohibits downloading/caching audiovisual content or offline playback without prior written approval | Do not use as a download provider |

### Primary documentation

- Cloudflare Stream downloads: https://developers.cloudflare.com/stream/viewing-videos/download-videos/
- Cloudflare signed/downloadable tokens: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- Mux assets and static renditions: https://www.mux.com/docs/api-reference/video/assets
- Mux download guidance: https://www.mux.com/docs/guides/download-your-videos
- Vimeo video file/download links: https://help.vimeo.com/hc/en-us/articles/12427806914577-About-video-file-download-links-from-the-API
- Vimeo API scopes: https://developer.vimeo.com/api/authentication
- Dailymotion generate download URLs: https://developers.dailymotion.com/docs/generate-download-urls
- PeerTube REST API: https://docs.joinpeertube.org/api-rest-reference.html
- YouTube API developer policies: https://developers.google.com/youtube/terms/developer-policies
- FlixQuest API contract: https://github.com/flixquest/flixquest/blob/main/openapi.json
- FlixQuest README/API notes: https://github.com/flixquest/flixquest/blob/main/README.md

## Recommended integration order

1. **Finish FlixQuest verification**: obtain an authorized base URL/API access from its service owner, verify /api/v2/providers and /api/v2/providers/status, and obtain a documented offline download contract or separate download endpoint. Do not turn links[].url playback links into download URLs by guessing.
2. **Add an owner-content adapter only if Vivid actually has owned/licensed assets**: Cloudflare Stream is the cleanest fit because its API has a documented download-generation lifecycle and signed-download flag. Keep account API tokens in server-side Firebase Functions/Secret Manager; the browser should receive only short-lived user-authorized download URLs.
3. **Mux/Vimeo/Dailymotion**: add only if Vivid has a corresponding creator/partner account and owned/licensed assets to expose. They are not drop-in public scrapers.
5. **Do not implement YouTube downloads** via Data API; policy expressly prohibits it absent prior written approval.

## Flickv4 research beyond the initial repository snapshot

The current public Flickv4 repository has moved to its v2.x.x architecture (122 commits shown in its current README). Its README documents Expo SDK 57 / React Native 0.86, expo-video, a native background-download stack, grouped TV downloads, and a private scraper backend. The current code confirms:

- src/config/env.ts: FlixQuest scraper URL is supplied as EXPO_PUBLIC_FLIXQUEST_API_URL; empty means feature disabled. This is configuration only, not a hosted backend URL or a service entitlement.
- src/services/FlixQuestService.ts: the app consumes the v2 API under /api/v2; it lists enabled providers and resolves movie/TV playback links. The mapped stream shape includes URL, headers, subtitles and HLS/file kind. It does not establish offline rights for the resolved stream.
- src/services/DownloadService.ts: native app implementation includes persisted job state, queue/resume, direct-file downloads, HLS variant/media playlist handling, segment concurrency/retries, subtitles, local playback and platform-specific local HLS serving.
- src/utils/hlsVariants.ts: parses HLS master/media playlists, variants, segment and key/map metadata and rewrites local playlists.
- src/components/DownloadResolverHost.tsx: mounts the app's resolver integration at the React Native app root.
- WebViewScraper.tsx was present in the older code snapshot, but player-WebView extraction and anti-bot/cookie interception are not an appropriate Vivid download integration. Do not port scraping, Cloudflare challenge handling, CAPTCHA handling, ad bypass, DRM or access-control circumvention.

The current FlixQuest app (separate project, not the same as Flickv4) provides an additional useful native implementation reference:

- Its current README documents the same Scraper API v2 playback endpoints and explicitly says the scraper backend is closed-source; API access/self-hosting requests go to flixquestapp@gmail.com.
- Its v4.2.3 release notes (22 Oct 2026) mention automatic renewal of positively identified expired links for supported API-backed downloads, with bounded attempts and persisted recovery metadata. This is evidence of a client-side recovery design, not evidence of a public scraper download endpoint.
- lib/services/offline_download_service.dart is a Dart MethodChannel bridge to native Android download code.
- android/.../downloads/StreamDownloadStore.kt uses AndroidX Media3 DownloadManager, HlsDownloader, DashDownloader, ProgressiveDownloader, persistent download index/cache, request recovery, and selected audio track metadata. This is a strong Android-native reference, but cannot be copied into the Vivid website runtime.
- The public FlixQuest OpenAPI still does not define a general offline-download route. The native app's use of a resolved manifest plus Media3 offline download does not automatically grant Vivid permission to persist arbitrary third-party streams.

External references:
- Flickv4 repository: https://github.com/sheeshcake/Flickv4
- FlixQuest repository: https://github.com/flixquest/flixquest
- FlixQuest v4.2.3 release notes: https://github.com/flixquest/flixquest/releases
- AndroidX Media3 offline downloads: https://developer.android.com/media/media3/exoplayer/downloading-media
- Expo FileSystem: https://docs.expo.dev/versions/latest/sdk/filesystem/

## Vivid-specific implementation recommendations

### Website first (current target)

- Keep the existing IndexedDB queue and OPFS direct-file adapter.
- Keep the current fail-closed FlixQuest client from scripts/downloads/flixquest-api.js; do not configure either repository-listed scraper host until live access is verified.
- Do not advertise HLS/DASH downloads through the browser direct-file adapter. Browser offline HLS requires a separately tested segment/playlist storage and playback design; it is not an MP4 file download.
- Require exact allowlisted HTTPS hosts, no credentials, no redirects, byte caps, MIME checks, cancellation cleanup, and short-lived URLs.
- Never put service secrets in static browser config. Put account credentials in server-side functions/secrets and authorize every download request against the signed-in user and the content owner entitlement.

### Android / Electron later

- Android: evaluate a native Media3 DownloadManager bridge for HLS/DASH, with persistent download index, license/rights checks, selected-track metadata and recovery. This is the right place to adapt the FlixQuest native architecture.
- Electron: use a main-process downloader with IPC allowlists and local filesystem storage; do not expose arbitrary filesystem writes to renderer code.
- Do not claim cross-platform parity until each target has an actual end-to-end offline playback test.

## Open blockers (no secrets in chat)

- Verified FlixQuest API base URL and permission to use the instance.
- A published/confirmed FlixQuest offline-download endpoint or explicit fields/contract that authorize offline storage.
- If using Cloudflare Stream/Mux/Vimeo/Dailymotion, the Vivid-owned account and authorized assets, configured privately in server-side secrets.
- A small, known-to-be-downloadable test movie and TV episode (or test assets owned by Vivid) for end-to-end browser tests.
