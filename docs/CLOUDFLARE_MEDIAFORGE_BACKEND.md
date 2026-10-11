# Vivid Cinema — Firebase + Cloudflare MediaForge backend

## Architecture and cost boundary

- Firebase Hosting remains the static website host.
- Cloud Firestore remains the app database. This change does not edit `firebase.json`, `firestore.rules`, or existing Firestore collections.
- Firebase Authentication remains the identity provider. The Cloudflare Worker verifies Firebase ID tokens using Google's published Secure Token signing keys and the configured Firebase project ID.
- Cloudflare Workers provides the lightweight HTTPS API edge.
- Cloudflare R2 is the planned persistent object store for completed, authorized media files.
- MediaForge's Python/FFmpeg processing worker is **not hosted by Cloudflare Workers**. Workers cannot run a conventional long-lived Python/FFmpeg service. The API intentionally returns HTTP 503 for playback/download operations until a real compatible processing worker is connected.

This is a safe deployment foundation, not a live MediaForge resolver or download service. It does not queue fake jobs, proxy arbitrary URLs, expose upstream API keys, or claim media is available when no worker can process it.

## Worker behavior

Implemented routes:

- `GET /health` and `GET /api/v1/health`: reports that the Worker responds and whether the R2 binding exists. `backendConfigured` remains false until processing is implemented.
- `POST /api/v1/stream/resolve`: validates the media identity, requires a valid Firebase ID token, then returns `503 media_backend_not_configured`.
- `POST /api/v1/downloads`: validates the media identity, requires a valid Firebase ID token, then returns `503 media_backend_not_configured`.
- `GET /api/v1/downloads/{jobId}`: requires a valid Firebase ID token, then returns `503 media_backend_not_configured`.

Only the exact `ALLOWED_ORIGIN` configured in Wrangler is accepted for browser cross-origin requests. Add the actual Firebase Hosting/custom domain to that setting before deployment. Do not use wildcard origins with bearer-token requests.

Firebase ID tokens are verified for RS256 signature, Firebase project audience and issuer, expiration, issue time, authentication time, and subject. The worker never trusts a decoded JWT without checking its signature.

## Free-tier deployment preparation

Prerequisites: a Cloudflare account and Wrangler CLI. Keep the Cloudflare account on its free plan; do not enable paid Workers features or upgrade Firebase billing.

1. Review `cloudflare/wrangler.toml`. Confirm `FIREBASE_PROJECT_ID` is `vivid-cinema` and set `ALLOWED_ORIGIN` to the exact production Vivid origin.
2. Create the R2 bucket named `vivid-mediaforge-media` if R2 is enabled for the account.
3. From the repository's `cloudflare` directory, run `npx wrangler deploy`.
4. Call the returned Worker URL's `/health` route and confirm `backendConfigured: false`. This is expected at this stage.
5. Keep the Worker URL out of Vivid's production configuration until the resolver/worker is implemented and end-to-end tested.

R2's published free allowance is limited (currently 10 GB-month of Standard storage, 1 million Class A operations, and 10 million Class B operations). Stay within the current allowance and set usage alerts if available. Do not assume unlimited or permanent free media hosting.

## Remaining work before any playback/download launch

1. Choose and deploy a real source resolver and long-running media worker on a genuinely free host, if one can meet the workload. A continuously available Python/FFmpeg worker cannot be guaranteed for $0.
2. Connect it through a narrow authenticated contract; do not expose MediaForge's internal routes as an unrestricted proxy.
3. Use R2 for completed media objects and enforce object ownership, maximum sizes, retention/cleanup, and signed or authenticated delivery.
4. Persist job metadata and ownership in Firestore using trusted server-side authorization, or another explicitly approved store. Never let a client assign another user's owner ID.
5. Add rate limiting/quotas, SSRF protection, cancellation, failure recovery, and authorized-source checks.
6. Wire the backend into the existing Vivid player and download UI only after end-to-end tests pass for movies, TV, anime, audio/subtitles, authorization, expiry, and storage persistence.

## Local tests

Run the Worker contract tests with:

```sh
node --test tests/cloudflare-mediaforge-worker.test.mjs
```

Run the existing client contract tests with:

```sh
node --test tests/mediaforge-client.test.mjs
```

No Firebase deployment or billing-plan change is required to review these files.
