# Vivid Cinema — MediaForge local companion (read-only)

This is an opt-in local development bridge, not a production deployment. It keeps the MediaForge API key in the local Python process and exposes only fixed read-only endpoints to explicitly allowed local development origins.

## Why this is read-only

The verified MediaForge /api/v1 OpenAPI contract includes status, queue and library reads, but does not define public v1 endpoints for source search, stream resolution/audio-track selection, or creating a download. This companion intentionally does not call undocumented UI routes or pretend those workflows are supported. Native search/player/download UI must wait for a maintainer-supported API contract or a separately reviewed implementation.

## Requirements

- Python 3.10+
- MediaForge running locally (default http://127.0.0.1:8080)
- A MediaForge API key scoped to read status, queue and library
- Vivid served locally on an allowed origin (default http://localhost:5500 or http://127.0.0.1:5500)

Do not expose this companion or MediaForge to the public internet. It binds only to 127.0.0.1, accepts only local MediaForge HTTP upstreams, has no arbitrary proxy path, and never returns the API key.

## Run on Windows PowerShell

From the Vivid Cinema repository root:

```powershell
$env:MEDIAFORGE_URL = "http://127.0.0.1:8080"
$env:MEDIAFORGE_API_KEY = "PASTE_YOUR_SCOPED_READ_ONLY_KEY_HERE"
$env:VIVID_ALLOWED_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500"
python .\tools\mediaforge-companion\server.py
```

In another PowerShell window, serve Vivid locally on port 5500 using your preferred static server. Open the local Vivid origin that exactly matches VIVID_ALLOWED_ORIGINS.

Check http://127.0.0.1:8765/health. Read-only routes:

- GET /api/status
- GET /api/queue
- GET /api/library

Stop with Ctrl+C. Do not paste the key into Vivid frontend code, commit it, put it in a URL, or use an administrator key when a read-only scoped key is available.

## Security limits

- Local loopback bind only; no LAN listener.
- Exact-origin CORS allowlist; CORS is not authentication, so keep the service local and use a scoped key.
- Fixed upstream routes only; no user-controlled URL or path forwarding.
- Five-second upstream timeout and 2 MiB response cap.
- Upstream redirects are rejected so the API-key-bearing request cannot be forwarded to another host.
- Upstream errors are reduced to safe error codes.
- No write methods, download enqueue, stream URLs, or audio-track claims.
- A hosted HTTPS Vivid page is not configured to call this local bridge. Local development is the intended environment until HTTPS/local-network behavior is separately reviewed.

## Current integration status

This is groundwork for local diagnostics, not native MediaForge playback. It does not change scripts/watch.js, the VidAPI player, or existing Watch Now / Play Episode actions. Streaming, source search, audio-track selection and download submission remain blocked on a supported API contract.