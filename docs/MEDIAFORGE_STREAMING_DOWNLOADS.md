# Vivid Cinema — MediaForge streaming and downloads

This integration intentionally excludes MediaForge's library/dashboard UI. The required surface is:

- resolve and play a movie, TV episode, or anime episode in Vivid's existing player;
- submit downloads and poll job progress;
- save completed files to persistent backend storage and provide an authenticated download URL.

## Current state

The browser-side client in `scripts/mediaforge-client.js` is an integration seam, not a live service. The public backend URL is intentionally not configured yet, so no user-facing playback behavior changes and no secrets are shipped to Vivid's static site. The client never accepts MediaForge API keys; it sends a signed-in user's bearer token to the first-party backend.

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

Response:
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

The media URL must be served or proxied from the same backend origin and use a short-lived, unguessable session token. The server must validate the upstream source and reject private-network, loopback, link-local, and metadata-service targets to prevent SSRF. It must not expose upstream credentials to the browser.

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

Allowed states: `queued`, `resolving`, `downloading`, `processing`, `ready`, `failed`, `cancelled`. A ready job may include `downloadUrl`, which must remain on the same backend origin. The server must scope job access to the requesting user.

## Storage and operations

- Use persistent object/file storage; never rely on ephemeral function filesystem or process memory for completed downloads.
- Run downloads/transcoding as background jobs, not inside a short-lived Vercel request.
- Store metadata (owner, media identity, size, checksum, status, expiry) separately from file bytes.
- Use signed/authorized downloads, quotas, size limits, cancellation, cleanup/retention policies, and rate limiting.
- Do not enable a public resolver or downloads until source rights and distribution permissions are confirmed.

## Next steps before production

1. Implement the authenticated backend and worker against this contract.
2. Deploy it with persistent storage and a supported source resolver.
3. Configure the backend URL and the Vivid player allowlist for that backend host.
4. Wire the resolver into the existing player and expose download progress in the title/watch UI.
5. Run end-to-end tests for movie, TV, anime, audio/subtitles, failures, cancellation, storage persistence, and authorization.

The client currently provides the tested API boundary only; it does not pretend that the backend or storage already exists.
