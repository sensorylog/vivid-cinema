# Vivid Cinema — MediaForge streaming and downloads

This integration intentionally excludes MediaForge's library/dashboard UI. The required surface is:

- resolve and play a movie, TV episode, or anime episode in Vivid's existing player;
- submit downloads and poll job progress;
- save completed files to persistent object storage and provide an authenticated download URL.

## Current state

The browser-side client in `scripts/mediaforge-client.js` is an integration seam, not a live service. The backend URL is intentionally not configured, so no user-facing playback behavior changes and no secrets are shipped to Vivid's static site. The client sends a signed-in user's Firebase ID token to the first-party backend and never accepts a MediaForge API key.

The Cloudflare Worker foundation is documented in [CLOUDFLARE_MEDIAFORGE_BACKEND.md](CLOUDFLARE_MEDIAFORGE_BACKEND.md). Firebase Hosting and Firestore remain unchanged. The Worker currently fails closed with HTTP 503 for stream/download operations because the real MediaForge processing worker is not deployed.

## Required backend contract

All endpoints are relative to the configured HTTPS backend origin. Every route must verify the Firebase ID token, enforce per-user quotas/rate limits, and only resolve content that the service is authorized to stream or distribute.

### Resolve a stream

`POST /api/v1/stream/resolve`

Request:
```json
{ "mediaId": "550", "mediaType": "movie" }
```

For TV/anime:
```json
{ "mediaId": "show-id", "mediaType": "tv", "season": 1, "episode": 2 }
```

Response contract:
```json
{
  "stream": {
    "url": "/media/signed-session/master.m3u8",
    "type": "hls",
    "expiresAt": "2026-10-11T16:00:00Z",
    "audioTracks": [],
    "subtitleTracks": []
  }
}
```

The media URL must be served by the same backend origin and use a short-lived, unguessable session token. The server must validate upstream sources and reject private-network, loopback, link-local, and metadata-service targets to prevent SSRF. Upstream credentials must never be exposed to the browser.

### Start a download

`POST /api/v1/downloads` accepts the same media identity payload and returns:
```json
{ "jobId": "job_123", "status": "queued" }
```

### Poll a download

`GET /api/v1/downloads/{jobId}` returns:
```json
{
  "status": "downloading",
  "progress": 42,
  "filename": "Example.mp4"
}
```

Allowed states: `queued`, `resolving`, `downloading`, `processing`, `ready`, `failed`, `cancelled`. A ready job may include `downloadUrl`, which must remain on the configured backend origin. Job access must be scoped to the requesting user.

## Storage and operations

- Keep Firebase Hosting for the website and Firestore for existing app data.
- Use Cloudflare R2 for completed authorized media objects, within free-tier limits and with retention/cleanup policies.
- Do not use a Worker request's memory or ephemeral filesystem for completed downloads.
- Cloudflare Workers does not run a conventional persistent Python/FFmpeg service. A compatible processing worker still has to be deployed separately; reliable always-on processing is not guaranteed to be free.
- Use signed/authorized downloads, per-user quotas, size limits, cancellation, cleanup, and rate limiting.
- Do not enable a public resolver or downloads until source rights and distribution permissions are confirmed.

## Next steps before production

1. Deploy the Cloudflare Worker and verify its health endpoint and Firebase token validation.
2. Select a compatible MediaForge processing worker. Do not configure a public backend URL while this component is missing.
3. Connect the worker to R2 for completed objects and use trusted authorization for per-user job metadata.
4. Configure the backend URL and the Vivid player allowlist only after actual playback is implemented.
5. Wire the resolver into the existing player and expose download progress in the title/watch UI.
6. Run end-to-end tests for movie, TV, anime, audio/subtitles, failures, cancellation, storage persistence, and authorization.

The client and Cloudflare Worker currently provide the tested API boundary/foundation only; they do not claim the resolver, media worker, or production storage delivery is already live.
