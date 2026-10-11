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
- A MediaForge process running on a developer's PC is only suitable for local integration tests. Production needs an always-on, secured deployment.
- Keep MediaForge as a separately deployed service. Do not copy its implementation into Vivid or expose its unauthenticated/internal endpoints directly to browsers.
- Review MediaForge's GPL-3.0 license and API/authentication documentation before choosing a distribution or deployment arrangement. Do not port any proprietary/solver components.

## Proposed integration shape

1. Create a dedicated Vivid page/entry point for MediaForge; do not modify the existing player route.
2. Configure the MediaForge service URL server-side, never hard-code credentials into frontend code.
3. Put a narrow Vivid backend adapter in front of the service where needed. Require authenticated access, validate requests and responses, apply rate limits, and do not accept arbitrary proxy URLs from users.
4. Use MediaForge's documented API/authentication mechanism. Prefer a supported OIDC/SSO flow or another supported secure account arrangement; never share an admin password or expose an admin token to the browser.
5. Display only source, server, audio, subtitle, quality and download metadata actually returned by the service. Prefer English when a source exposes language metadata, but show every verified available dub. Never imply an English audio track exists when it does not.
6. Keep streaming and download actions separate and label them clearly.

## Delivery phases

### Phase 0 — compatibility and API verification
- Inspect MediaForge REST API, authentication, CORS/reverse-proxy behavior, stream playback response, queue/download endpoints, and storage model.
- Confirm deployment options, network boundaries, authentication integration, and license implications.
- Record API contract and supported source/language metadata before implementing UI.

### Phase 1 — isolated proof of concept
- Add only a new feature entry point/page and service adapter.
- Use a non-production MediaForge instance and test titles.
- Do not alter existing Vivid player files or existing Watch Now/Play Episode handlers.

### Phase 2 — stream and download workflows
- Add server/source selection and playback.
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
- English is preferred when the source explicitly offers it.
- All other audio languages actually reported by the source remain selectable.
- A German-only source is clearly labelled German; no fake English option is shown.
- Streaming and downloading each have working, separately tested workflows.
- Deployment, authentication, storage limits, and license review are documented.
