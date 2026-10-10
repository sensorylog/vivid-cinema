# Authorized direct-stream integration

Vivid's direct player is an adapter, not a content catalog. No direct stream provider is enabled by default.

## Enablement contract

1. Add only exact, lowercase HTTPS hostnames controlled by an authorized streaming provider to `VIVID_CONFIG.api.directStreamHosts` in `scripts/config.js`. Include every host needed for manifests, segments, captions, and other media resources; HLS.js and Shaka enforce the allowlist on their media requests too.
2. Load a first-party provider integration before `scripts/watch.js`. It must set `window.VIVID_DIRECT_STREAM_RESOLVER` to an async function.
3. The resolver receives:
   - `media: { id, media_type, title }`
   - `episode: { season, episode }` for TV, or `null` for movies
4. Return `{ url, type }`, where `type` is `hls`, `dash`, or `file`. Return `null` when the provider has no authorized stream for the requested title/episode.
5. Never put signed URLs, API keys, or other credentials in the watch-page query string or local playback preferences.

The browser validates HTTPS, rejects URL credentials and non-allowlisted hosts, and supports HLS (`.m3u8`), DASH (`.mpd`), and direct video files (`.mp4`, `.m4v`, `.webm`, `.mov`, `.ogv`). HLS/DASH resources must permit browser playback with the correct CORS headers. DRM/license-server configuration is intentionally not guessed or enabled.

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
