# African Stories — Phase 4 engineering foundation

**Status:** foundation implemented on PR #524; not production playback-ready  
**Branch:** `feat/african-stories-phases-2-7`

## Delivered in this increment

### 1. Server-authoritative catalogue workflow
- Added a Cloud Functions module for African Stories. All five callable operations require Firebase App Check and apply dedicated custom-claim authorization where appropriate.
- `saveAfricanWorkDraft` requires the `africanStoriesEditor` claim and validates canonical work IDs, work types, editions/versions, language tracks, credits and HTTPS source citations.
- `publishAfricanWork` requires `africanStoriesPublisher`, checks minimum editorial fields and publishes a deliberately limited public projection.
- Editorial input cannot assign `licensed_embed` or `stream_on_vivid` public access states.

### 2. Rights and provider controls
- `registerAfricanProvider` requires `africanStoriesProviderAdmin`, an HTTPS origin-only embed origin, an agreement reference and an explicit security-review confirmation.
- `setAfricanRightsDecision` requires `africanStoriesRightsAdmin`, exact work/version identity, an active reviewed provider, an HTTPS provider origin, explicit territory codes and a bounded valid-from/valid-until window.
- Rights decisions are private server-side records; client writes and reads are denied by Firestore rules.
- Provider registration does not prove an agreement exists. The agreement reference and security-review flag are operational attestations that must be backed by actual signed evidence and review before use.

### 3. Playback session broker and isolated player
- Added `createAfricanPlaybackSession`. The initial broker requires a signed-in account, exact public work/version match, approved private grant, active provider, exact URL origin, rights term and territory match.
- Provider discovery has now identified multiple adapter classes that the initial foundation did not model: official platform embeds (YouTube, Vimeo, PeerTube), explicitly public archive files (eligible Internet Archive files), and contracted partner sessions (signed HLS/DASH or provider-issued embeds).
- The current broker only supports the third class and has no session adapter configured. The next implementation increment must add provider-specific handling for official embeds and public files rather than requiring every provider to mint a Vivid-specific short-lived token.
- Territory verification is deliberately fail-closed. No trusted geo header is configured by this code. Playback stays disabled until infrastructure supplies a trusted header through a proxy that strips/overwrites any client-supplied value. Do not set `AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER` until that ingress behavior has been verified.
- Added a separate `african-stories-watch.html` player route. It never searches alternate providers or guesses URLs. It creates an iframe only after a provider-specific server adapter returns an authorized session and the browser confirms HTTPS and exact origin equality; the browser closes the frame when the returned expiry is reached.
- Existing CSP `frame-src` must be updated with an exact provider origin only after the provider and embedding behavior have passed legal and security review. No broad wildcard has been added.

### 4. Restricted operations console and roles
- Added `african-stories-admin.html` and a callable-only operations console.
- Browser controls are hidden unless the refreshed Firebase ID token has a matching dedicated role; every operation is independently checked server-side.
- Added `automation/set-african-stories-claims.mjs` for trusted operators using Firebase Admin Application Default Credentials. It preserves unrelated custom claims and can remove the African Stories roles with the `none` argument.
- No role can be assigned from the browser. Do not grant roles to unreviewed accounts.

### 5. Firestore and PWA
- Public projections: `africanWorksPublic`, `africanPeoplePublic`, `africanInstitutionsPublic`, `africanCollectionsPublic`, `africanTimelinesPublic`.
- Private namespaces: drafts, rights grants, provider registry, editorial queue, playback sessions and audit events. Client access is denied even for custom-claim users; privileged Functions use Admin SDK.
- Added initial public catalogue composite indexes.
- Added emulator rule tests for public read-only behavior and private denial.
- Added a service-worker shell version bump and precache entries for the new player and admin routes/modules.

## Current public access states

Editorial publication can expose only:
- `archive_record`
- `access_pending`
- `watch_officially`

Vivid playback entitlement is computed from the private title/version rights grant at session creation. It is not trusted from public metadata or client input.

## Important security boundaries

1. A client-supplied territory is never accepted. The trusted country header must be supplied by a verified ingress layer that overwrites inbound values. Until then the broker returns `failed-precondition`.
2. Static title URLs are not stored in rights grants. Provider session URLs are returned only after entitlement checks, must be HTTPS and must match the exact registered provider origin.
3. The browser never reads private grants, contracts, provider registry or sessions.
4. The public projection contains no provider URL, contract, fee, rights note or secret.
5. No provider is preconfigured, no title has a seeded grant, no rights are claimed secured and no Vivid playback is enabled by default.
6. The partner-session adapter registry is intentionally empty. No generic static-iframe adapter exists. Official public embeds and public archive files require their own source-specific validation and player adapters; contracted protected streams require a provider-specific server-side session issuer. An approved rights grant alone does not enable licensed Vivid playback. CSP and provider security review remain explicit gates.
7. Admin claims are out-of-band privileged operations. The role assignment utility must be run only by an authorized Firebase administrator.


### 4. Public provider runtime (implemented on this PR)
- `scripts/african-stories/providers.js` contains strict source validation and provider-specific URL/file resolution for YouTube, Vimeo, the reviewed PeerTube origins and Internet Archive.
- `scripts/african-stories/player.js` loads an exact published work/version from the public catalogue, renders only editorially enabled sources, switches between official platform embeds and the HTML5 archive player, and preserves original-platform/archive fallbacks.
- FilmFlux trending discovery is available at `african-stories-watch.html?provider=filmflux`. The feed is credited and its YouTube IDs are played through YouTube's own player.
- The player includes a curated external directory for Wazi Movies, NG-Movies, AfriDocs and CINAF. These are official outbound destinations, not falsely represented as integrated APIs or Vivid-hosted streams.
- Version source records are validated by `saveAfricanWorkDraft` and published only with the exact edition. Official embeds require `watch_officially` plus an evidence reference. Archive playback requires an explicit rights basis and evidence reference; the player verifies the exact public file at runtime. The restricted operations console now provides provider source templates. Evidence references stay private in drafts and are removed from the public projection.
- Provider adapter unit tests are included in `tests/african-stories-providers.test.mjs`; callable validation tests cover published official and archive source records. Test results are pending until CI runs for the final head.

## Not yet complete

- Production trusted geolocation/territory integration and spoof-resistant ingress configuration.
- Actual provider contracts, title/version chain-of-title and written playback permissions.
- Protected partner-session adapter implementations and provider-specific authentication/token refresh for contracted CDNs. Public-source adapters for YouTube, Vimeo, Dailymotion, Rumble, reviewed PeerTube instances and eligible Internet Archive files are implemented in `scripts/african-stories/providers.js` and the dedicated player. FilmFlux's documented public trending feed is implemented as a discovery connector.
- Production monitoring and terms/attribution review for the FilmFlux public discovery endpoint. The client connector fails gracefully; no full catalogue bulk feed is assumed.
- Technical/partner diligence for Wazi Movies, NG-Movies, AfriDocs and CINAF; no API or syndication rights are assumed.
- CSP and code allowlist updates for each additional PeerTube instance or partner embed origin. Current PeerTube allowlist is limited to `framatube.org` and `peer.tube`; Vimeo and FilmFlux/Internet Archive origins are added.
- Full editorial CMS UX, record search/review queue, person/institution/collection/timeline workflows and asset permissions.
- Playback revocation/kill-switch UI, licence-expiry alerting, provider health monitoring and takedown operations.
- Firestore emulator, unit, syntax, static build, Android and desktop test results for this commit.
- Production deployment and end-to-end device verification.

## Verification

The repository test suite and GitHub Actions are the verification source of truth. Do not report a check as passed until its run concludes successfully. A successful static test does not establish provider authorization or title rights.

## Next engineering sequence

1. Run and fix the Functions syntax and unit tests.
2. Run Firestore emulator rules tests and verify every new private namespace is inaccessible to browser clients.
3. Complete the catalogue/admin editorial experience and source/asset provenance handling.
4. Continue production QA for the implemented YouTube/Vimeo/Dailymotion/Rumble/PeerTube/Internet Archive adapters and FilmFlux connector; add new PeerTube origins only after review. Keep protected partner CDN integrations behind provider-specific contracts and session adapters.
5. Integrate a trusted territory resolver and exact CSP origin only after ingress spoofing tests.
6. Add session revocation, expiry jobs, audit review, kill switches and monitoring.
7. Run all existing playback, downloads, account, PWA, Android and desktop regression suites.
