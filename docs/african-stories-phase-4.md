# African Stories Phase 4 — dedicated player and provider-session contract

## What this phase delivers

- A separate African Stories player route and runtime, independent of the existing movie/TV and anime playback systems.
- A versioned, published catalogue manifest. The repository starts with an intentionally empty catalogue; no sample or placeholder title is presented as playable.
- A fail-closed rights policy. A title must be published, carry a verified title/edition grant with evidence, rights holder, territory and validity window, and have a source with an active status plus a verified authorization record.
- Validated official YouTube, Vimeo and PeerTube embeds, and Internet Archive file resolution against the exact public item metadata.
- Source selection, source-load timeout, fallback to the next eligible source, explicit unavailable states and original-source links.
- A partner-session API boundary. Browser clients submit title, edition and source IDs only; they cannot submit a playback URL.
- A Cloudflare Pages Function that delegates session issuance to the optional `AFRICAN_STORIES_PROVIDER` service binding. The binding is the trusted provider registry and must re-check title-level rights, territory, time window and source authorization before minting a short-lived playback URL.
- A FilmFlux discovery feed kept separate from Vivid-licensed playback. Its results are discovery leads, not title grants.

## Provider-session service contract

Configure a Cloudflare Pages service binding named `AFRICAN_STORIES_PROVIDER` only after a provider agreement and server-side adapter have been reviewed. The binding receives a POST at `https://african-stories-provider.internal/session` with `titleId`, `editionId`, `sourceId` and request origin. It must return JSON containing:

- `ok: true`
- `playbackUrl`: HTTPS short-lived playback URL
- `expiresAt`: ISO-8601 UTC timestamp no more than 15 minutes in the future
- `mimeType`: one of HLS, DASH, MP4 or WebM MIME types accepted by the browser adapter
- `sessionId`: opaque session identifier

The provider service must independently validate the published title/edition, signed or otherwise auditable rights evidence, allowed territory, validity window, provider registration, source status and any user entitlement. It must not trust browser-supplied URLs or claims. Keep provider credentials in the service binding's secret store, never in static JavaScript or the catalogue.

## Current operational status

The repository has no configured provider-session service binding and the published catalogue is empty. The API reports this state and returns HTTP 503 rather than inventing a playable stream. Official third-party embeds can only be listed when their source record is explicitly enabled and authorized; archive files additionally require the title grant. No source is marked playable by default.

This phase supplies the player and trust-boundary integration contract. It does **not** claim a commercial provider partnership, a live provider adapter, title-level licensing, or production playback until the service binding and real title grants exist and are tested.

## Catalogue title shape

Each published title should include `id`, `editionId`, `published: true`, `accessState`, `rightsGrant` and `sources`. The rights grant requires `status: "verified"`, `rightsHolder`, `basis`, `evidenceRef`, `territories`, and `expiresAt` (with optional `startsAt`). A source requires `sourceId`, `provider`, `enabled: true`, `authorized: true`, `status: "active"`, and `authorization.status: "verified"`, `authorization.authorizedBy`, and `authorization.evidenceRef`. Never set these fields based only on a catalogue listing, search result or archive record.
