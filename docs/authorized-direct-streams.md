# Authorized direct-stream integration

Vivid's direct player is an adapter, not a content catalog. No direct stream provider is enabled by default.

## Enablement contract

1. Add only exact HTTPS hostnames controlled by an authorized streaming provider to `VIVID_CONFIG.api.directStreamHosts` in `scripts/config.js`. The code normalizes case and rejects entries containing schemes, paths, credentials, or ports. Include every host needed for manifests, segments, captions, and other media resources.
2. Load a first-party provider integration before `scripts/watch.js`. It must set `window.VIVID_DIRECT_STREAM_RESOLVER` to an async function.
3. The resolver receives:
   - `media: { id, media_type, title }`
   - `episode: { season, episode }` for TV, or `null` for movies
4. Return `{ url, type }`, where `type` is `hls`, `dash`, or `file`. Return `null` when the provider has no authorized stream for the requested title/episode.
5. Never put signed URLs, API keys, or other credentials in the watch-page query string or local playback preferences.

The browser validates HTTPS, rejects URL credentials and non-allowlisted hosts, and supports HLS (`.m3u8`), DASH (`.mpd`), and direct video files (`.mp4`, `.m4v`, `.webm`, `.mov`, `.ogv`). HLS/DASH resources must permit browser playback with the correct CORS headers. DRM/license-server configuration is intentionally not guessed or enabled.

## Request-validation boundaries

The initial stream URL is checked against the exact HTTPS hostname allowlist before playback. HLS.js checks each resource URL it handles, and its fetch-based requests use `redirect: "error"` to fail closed when the server redirects. Shaka checks each DASH resource URL before requesting it. Browser-managed native HLS playback and direct video-file playback do not expose a reliable JavaScript hook for validating every redirect or every nested request; do not treat the client-side allowlist as a complete network security boundary. Configure the authorized provider/CDN to serve manifests, segments, captions, and files from the expected allowlisted hosts without cross-host redirects. The unit tests cover URL validation and stream-type inference, not end-to-end playback on real devices.

## Resolver example shape

This is a contract example, not a working provider or endpoint:

```js
window.VIVID_DIRECT_STREAM_RESOLVER = async ({ media, episode }) => {
  // Call your existing first-party backend/provider integration here.
  // It must verify rights and return only a stream this viewer may access.
  // Return null when no authorized stream is available.
  return null;
};
```

The empty host allowlist keeps the direct source hidden until an authorized integration is configured. The player loads pinned HLS.js and Shaka Player builds only when a compatible direct stream is selected. For production, consider self-hosting reviewed builds and serving them with your site's security policy.

## Custom embed servers

The watch-page server picker also supports up to 10 user-configured HTTPS embed servers. This follows the general server-registry and per-server movie/TV URL-pattern approach seen in Flickv4, but the browser implementation is written for Vivid's existing HTML/JavaScript player rather than importing the native React Native player.

- Add servers from **Watch → Servers → Manage your servers**.
- Configure the HTTPS base URL plus separate movie and TV episode URL patterns.
- Supported placeholders are `{url}`, `{type}`, `{tmdbId}`, `{imdbId}`, `{slug}`, `{season}`, and `{episode}`.
- Both patterns are validated before saving; generated playback URLs must stay on the configured HTTPS origin.
- Up to 10 server definitions are stored in this browser's local storage. They are not synced to Vivid accounts or uploaded to a backend.
- The custom-server player opens the configured embed page in the existing iframe. Cross-origin browser security prevents Vivid from inspecting the embedded player's internal playback state, subtitles, or quality tracks, so these controls remain owned by the provider.
- Only add servers you own or are authorized to use. This feature does not scrape pages, decrypt provider APIs, bypass DRM, or establish content rights.

### Reference and licensing note

Flickv4's published repository is licensed under GPL-3.0: https://github.com/sheeshcake/Flickv4. Vivid remains MIT-licensed. This integration reimplements the server registry and URL-pattern workflow for Vivid's browser architecture; it does not copy Flickv4 source files or import its native player, private scraper, remote server list, or third-party source-decryption code. Review licensing before moving any verbatim GPL-licensed code into Vivid.
