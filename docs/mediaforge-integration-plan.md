# MediaForge integration plan

## Scope and non-negotiable boundary

Add MediaForge as a separate, opt-in feature in Vivid Cinema. Existing Vivid streaming, its player, current VidAPI integration, and current title routes must remain unchanged.

The new feature may offer two distinct actions:
- **MediaForge Stream**: open or play a stream supplied by the configured MediaForge service.
- **MediaForge Download**: enqueue and track a download supplied by that service.

Do not silently route existing Vivid Watch Now or Play Episode actions through MediaForge.

## Repository and deployment facts

- Vivid Cinema is a static Firebase Hosting app with Firebase Cloud Functions.
- MediaForge is a separate Python web application with its own web UI, authentication, REST API, media storage, and runtime requirements.
- The MediaForge external API uses an `X-Api-Key` header at `/api/v1/*`; its OpenAPI document is exposed at `/api/v1/openapi.json`. API keys support scopes. The currently identified v1 endpoints cover status, queue, library, stats, AutoSync, uptime, update status, media scan, upscale, and history. Do not assume these endpoints provide source discovery, playback resolution, or download creation until the live OpenAPI contract confirms it.
- A MediaForge process running on a developer's PC is only suitable for local integration tests. A deployed Vivid page cannot use `localhost:8080` to reach the developer's PC from a visitor's device. HTTPS pages also cannot safely rely on direct HTTP localhost fetches across browsers; CORS, browser mixed-content rules, and MediaForge authentication must be verified.
- For the first proof of concept, test from the same PC with an explicitly configured local development setup. Do not put a MediaForge API key in frontend JavaScript or commit it to the repository. Do not expose the local service to the public internet. If a remote Vivid page must call the local instance, design and review a secure tunnel or local companion approach first.
- Production needs an always-on, secured deployment with durable storage and a supported authentication arrangement.
- Keep MediaForge as a separately deployed service. Do not copy its implementation into Vivid or expose its unauthenticated/internal endpoints directly to browsers.
- Review MediaForge's GPL-3.0-or-later license and API/authentication documentation before choosing a distribution or deployment arrangement. Do not port any proprietary/solver components.

## Proposed integration shape

1. Create a dedicated Vivid page/entry point for MediaForge; do not modify the existing player route.
2. Configure the MediaForge service URL server-side or in a local-only development configuration; never hard-code credentials into frontend code.
3. Put a narrow Vivid backend adapter in front of the service where needed. Require authenticated access, validate requests and responses, apply rate limits, and do not accept arbitrary proxy URLs from users.
4. Use MediaForge's documented API/authentication mechanism. Prefer a supported OIDC/SSO flow or another supported secure account arrangement; never share an admin password or expose an admin token to the browser.
5. Confirm the supported endpoints for source search/details, playback/source resolution, download enqueue, queue status, and download/library file access before implementing these flows. Use only documented, scoped API permissions.
6. Display only source, server, audio, subtitle, quality and download metadata actually returned by the service. Prefer English when a source exposes language metadata, but show every verified available dub. Never imply an English audio track exists when it does not.
7. Keep streaming and download actions separate and label them clearly.

## Delivery phases

### Phase 0 — compatibility and API verification
- Inspect the current MediaForge OpenAPI contract, authentication, CORS/reverse-proxy behavior, stream playback response, and queue/download endpoints.
- Confirm whether the public v1 API supports the required stream/download operations. If not, use only supported alternatives or pause for a maintainer-supported API rather than coupling to undocumented internal UI endpoints.
- Confirm deployment options, network boundaries, authentication integration, and license implications.
- Record API contract and supported source/language metadata before implementing UI.

### Phase 1 — isolated local proof of concept
- Start with a non-production MediaForge instance on the user's PC and a local-only development workflow.
- Add only a new feature entry point/page and service adapter.
- Do not alter existing Vivid player files or existing Watch Now/Play Episode handlers.
- Do not commit local URLs, credentials, tokens, downloaded media, or machine-specific paths.

### Phase 2 — stream and download workflows
- Add server/source selection and playback using documented APIs.
- Add download enqueue, progress/status, errors, and safe file access.
- Add English-first ranking while retaining all reported languages and a manual selection.

### Phase 3 — validation
- Run syntax/build/CI checks.
- Test signed-out and signed-in access, invalid requests, service unavailable, CORS/auth failures, playback errors, download lifecycle, and mobile/desktop layout.
- Verify the existing Vivid streaming routes and player files are unchanged.
- Do not merge or deploy until the integration tests and production service configuration are confirmed.

## Acceptance criteria

- Existing Vivid streaming works exactly as before.
- MediaForge is accessed only through a separately configured service.
- No secrets or admin credentials are shipped to the browser.
- Local proof of concept works from the intended local test environment, with the localhost/network boundary clearly understood.
- English is preferred when the source explicitly offers it.
- All other audio languages actually reported by the source remain selectable.
- A German-only source is clearly labelled German; no fake English option is shown.
- Streaming and downloading each have working, separately tested workflows.
- Deployment, authentication, storage limits, and license review are documented.


## Confirmed API boundary (source inspection)

The upstream MediaForge code confirms the blocker for a native Vivid adapter:
- The stable `/api/v1/*` interface currently exposes read-oriented status, queue, library, statistics, AutoSync, uptime, update, media-scan, upscale-status, and history routes. It does not currently declare a versioned source-search, stream-resolution, or download-enqueue endpoint.
- The built-in UI uses unversioned internal routes such as `/api/series`, `/api/stream/*`, and `POST /api/download`. These are not the documented stable external contract; the app's security code explicitly notes that cross-origin JSON requests are not allowed by its CORS policy.
- Therefore, a direct browser integration from Vivid cannot safely use the API key against those internal endpoints, and a server-side Vivid proxy cannot reach a MediaForge instance that is only running on the user's PC. Do not work around this by placing credentials in query strings or using session-authenticated internal routes as if they were public APIs.

The next safe step for a full native integration is to add/obtain a maintainer-supported, scoped API contract for source search, playback resolution, and download creation, plus a reachable HTTPS MediaForge deployment (or a separately reviewed local companion bridge for local-only use). Until then, the isolated launcher is the only implementation that is honest about the available contract.

## Local launcher implementation status

The first code slice is now on this feature branch: `mediaforge.html` provides a separate MediaForge launch page, linked from the Vivid home navigation. It defaults to `http://localhost:8080`, accepts only localhost HTTP or HTTPS for remote instances, remembers the base URL in browser-local storage, and opens the service in a separate tab. It does not collect API keys, embed the service, or modify the existing VidAPI playback code. The service worker shell cache was bumped to include this page and its assets.

**Scope boundary:** this is a local-instance launcher, not yet a native Vivid search/player/download integration. The documented external v1 API currently focuses on library, queue, status, and administration; source discovery and stream resolution must be verified against the running instance's actual routes before a server adapter can safely be built. Browser-level checks on the user's PC and production deployment checks remain outstanding.

