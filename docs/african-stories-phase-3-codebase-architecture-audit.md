# African Stories — Phase 3 codebase architecture audit

**Status:** completed against branch `feat/african-stories-phases-2-7`  
**Repository:** `sensorylog/vivid-cinema`  
**Purpose:** validate the Phase 3 master blueprint against the actual application structure before Phase 4 implementation.

This is a source-code inspection, not a deployment, runtime penetration test, legal review or provider authorization.

## 1. Executive findings

VividCinema is a static, multi-page JavaScript application with Firebase services, not a server-rendered SPA or a general-purpose CMS. The existing stack is suitable for an additive African Stories product, provided the implementation respects the following boundaries:

1. Add dedicated HTML routes and namespaced browser modules. Do not force African Stories into the existing movie/TV or anime title resolver.
2. Use the existing Firebase project and Firestore as the initial catalogue data store; use Cloud Functions with the Admin SDK for privileged writes, publication and playback entitlement decisions.
3. Keep public catalogue projections physically separate from private rights, contracts, provider credentials, unpublished drafts and audit records. Firestore rules are document-level, not field-level.
4. Reuse the existing trusted-moderator authentication pattern only as a reference. African Stories needs narrower custom claims and server-side authorization; the generic `moderator` claim must not grant rights-administration powers.
5. Build a dedicated African Stories editorial/admin surface. The current editorial desk is a newsroom tool, not a film catalogue CMS.
6. The current direct-stream player engine is a low-level authorized-stream runtime with an intentionally empty direct-host allowlist. It is not a provider catalogue or entitlement service. African Stories must own its third-player route, resolver, entitlement and provider registry.
7. Keep the first release discovery-led. An archive record, official external route, licensed embed and Vivid-hosted stream are distinct outcomes.

## 2. Verified application architecture

### Frontend and routing
- The application is static HTML with ES modules and page-specific scripts/styles.
- `scripts/routes.js` defines a small route registry for the existing home, title, watch, discover, For You, anime, collection, library, login/signup and account pages. `getRoute()` resolves the final pathname segment and query parameters.
- `scripts/config.js` centralizes existing page paths and API configuration.
- `home.html` owns the primary navigation and existing movie/TV discovery shelves.
- There is no evidence in the inspected route layer of a central SPA router or a general CMS page framework.

**Implication:** add explicit African Stories routes to the route registry/config and add dedicated page files. Keep URL builders and parsers in a new namespaced module such as `scripts/african-stories/routes.js`. Do not overload `title.html`, `watch.html`, or anime query semantics.

### Backend and data
- `firebase.json` configures Firebase Hosting, Firestore rules/indexes and a Cloud Functions codebase named `news-ingestion`, running Node.js 22.
- `scripts/firebase.js` initializes Firebase Auth and Firestore and provides lazy App Check initialization.
- `functions/index.js` initializes Firebase Admin and Firestore. Existing exports include scheduled newsroom ingestion and a callable community-poll results function.
- Firestore rules default-deny unmatched documents and already contain explicit user-owned data, newsroom, moderator and dormant community namespaces.
- The repository includes emulator-backed Firestore rule tests in `tests/firestore.rules.test.mjs` and a dedicated `npm run test:rules` script.
- The existing Functions package is the natural place for server-authoritative African Stories callable endpoints; do not expose Admin SDK access or provider secrets to browser code.

**Implication:** use the existing Firebase project rather than introduce a second database for the initial product. Add namespaced collections and Functions exports. Keep rights records and private operational data out of public client-readable documents.

### Editorial and admin workflow
- `moderator.html` is the existing moderation/news editorial surface.
- `scripts/editorial-desk.js` manages approved news sources and publication of newsroom articles; it uses the Firebase Auth custom claim `moderator`.
- `scripts/moderation.js` handles member reports.
- Firestore `isModerator()` checks the broad custom claim `request.auth.token.moderator == true`.

**Implication:** do not turn the newsroom desk into a film archive/rights CMS. Build a separate African Stories admin route and modules. Reuse patterns for authenticated state, auditability and accessible forms, but define narrow claims such as `africanStoriesEditor` and `africanStoriesRightsAdmin`. Rights approval and provider activation must be server-authorized and must never be granted by the generic newsroom moderator claim.

### Existing playback
- `scripts/watch.js` owns the current movie/TV watch experience.
- `scripts/playback/tflix-secondary-player.js` is a separate secondary player.
- `scripts/playback/anime-secondary-player.js` owns anime-specific playback.
- `scripts/playback/player-engine.js` supports authorized direct file/HLS/DASH playback and validates URLs against configured exact HTTPS hosts.
- `scripts/config.js` currently sets `directStreamHosts: []`; the player engine deliberately has no default stream endpoint.
- `scripts/playback/provider-adapters.js` is a capability registry for existing Watch Room provider messaging, not a licence or rights registry.

**Implication:** do not register African sources in existing movie/anime provider lists. Phase 4 creates a third isolated playback subsystem and may reuse only carefully reviewed low-level media primitives. The African entitlement service must run before a playback session is created. No direct stream host should be added without an authorized provider agreement and security review.

### Quality and delivery
- `package.json` defines a broad Node test suite, syntax checks, static build and Cloudflare Functions build.
- Existing tests cover route-adjacent navigation, Firestore rules, player behavior, downloads, service worker, PWA, Android and desktop behavior.
- `service-worker.js`, `firebase.json`, `manifest.json`, Capacitor configuration and the desktop package are production-sensitive integration points.

**Implication:** new African Stories pages/assets need explicit service-worker cache strategy and static build checks. Add regression tests proving existing movie, anime, live, download, authentication and library flows remain unchanged.

## 3. Recommended Firestore boundaries

Use separate collections for public projections and private workflow/rights data. This is required because Firestore security rules authorize whole documents, not individual fields.

| Namespace | Purpose | Client access |
|---|---|---|
| `africanWorksPublic` | Published public work/version summary and public access state | Public read; no client writes |
| `africanPeoplePublic` | Published people and verified credits | Public read; no client writes |
| `africanInstitutionsPublic` | Public archive/institution profiles and contact routes | Public read; no client writes |
| `africanCollectionsPublic` | Curated public collections | Public read; no client writes |
| `africanTimelinesPublic` | Reviewed timeline entries and public sources | Public read; no client writes |
| `africanWorkDrafts` | Unpublished canonical records and editorial review state | No direct client access; Admin SDK only |
| `africanRightsGrants` | Contracts, chain-of-title, territory, term, monetization and legal review | No client access; Admin SDK only |
| `africanProviderRegistryPrivate` | Provider agreement references, server-side configuration and secret references | No client access; Admin SDK only |
| `africanEditorialQueue` | Candidate records, source matching and review tasks | No direct client access; privileged Functions only |
| `africanAuditEvents` | Immutable rights/publication/access-state audit events | No client access; Admin SDK only |

These are logical namespaces; physical collection design and indexes are finalized in Phase 4. Do not put a contract URL, private licensor contact, fee, revenue share, legal note, API key, signed URL or provider secret in a public document.

Public work documents should carry a stable internal work ID, public-safe metadata, source citations, reviewed access state, publication/version markers and update timestamps. They should not expose the private rights decision record. Public access state is a projection derived from private review and entitlement state.

## 4. Privilege model

Use custom claims with least privilege:

- `africanStoriesEditor`: create/edit drafts and submit records for review.
- `africanStoriesPublisher`: approve and publish public catalogue projections.
- `africanStoriesRightsAdmin`: manage rights evidence and rights-state decisions.
- `africanStoriesProviderAdmin`: manage approved provider configurations and operational status.

A person may hold more than one claim only when explicitly assigned. A generic `moderator` claim must not imply any of these roles. Rights approval, provider activation, publication and takedown should be enforced inside callable/server functions using verified ID tokens and server-side authorization, with Firestore client writes denied for all private namespaces.

For early development, roles can be provisioned manually by a trusted project administrator. Do not build self-service role assignment.

## 5. Route and module boundary

Recommended additive route family:

- `african-stories.html` — main discovery landing and editorially curated entry point.
- `african-stories-country.html` — country/region hub.
- `african-stories-work.html` — canonical work detail.
- `african-stories-person.html` — person and credits.
- `african-stories-collection.html` — collection detail.
- `african-stories-timeline.html` — timeline/event context.
- `african-stories-watch.html` — dedicated third-player runtime and official-route fallback.
- `african-stories-admin.html` — scoped editorial and rights workflow.

Recommended module namespace:

`scripts/african-stories/`
- `routes.js`
- `catalogue.js`
- `search.js`
- `taxonomy.js`
- `provenance.js`
- `access-state.js`
- `rights-client.js` (calls privileged endpoints; contains no secret or authority)
- `player/` (resolver client, player runtime, provider adapter interface, error mapping)
- `admin/` (draft editor, review queue, rights review, publication workflow)

Names are proposed boundaries, not files already present.

## 6. Third-player trust boundary

The browser must never decide that a work is licensed. It requests a short-lived playback session from a server endpoint with a canonical work/version ID. The server:
1. resolves the exact work/version;
2. checks the current user's/visitor's eligibility and request origin;
3. checks territory, grant term, platform, monetization, provider and permitted delivery method;
4. rejects missing, ambiguous, expired, suspended or mismatched rights;
5. creates a short-lived session only for an approved provider;
6. returns only the minimum client configuration needed to play.

The player client validates provider origins against an allowlist and renders a distinct state when no authorized route exists. It must not attempt alternate providers or construct guessed stream URLs. Provider credentials and contract details remain server-side.

Official external viewing links are a separate access-route type. A verified YouTube or broadcaster link must not be represented as Vivid playback or used to infer rights in underlying archive material.

## 7. Integration risks and required controls

| Risk | Why it matters | Required control |
|---|---|---|
| Rights data leaks through public document | Firestore is document-level authorization | Separate private collections and public projections |
| Generic moderator overreach | Existing claim controls newsroom/community moderation | Dedicated African Stories claims; server-side checks |
| Existing player regression | Multiple distinct playback systems are active | Separate route/runtime; regression tests for all existing players |
| Unreviewed cache behavior | PWA can cache HTML/JS and stale routes | Explicit cache versioning and offline behavior tests |
| Asset rights conflated with film rights | Posters/stills/trailers can have separate terms | Per-asset permission and expiry records |
| Public catalogue implies stream availability | Archive records and official links are not Vivid rights | Public access-state labels; entitlement fail-closed |
| Metadata reuse violation | Discovery access does not grant bulk commercial reuse | Source-by-source terms and attribution register |
| Historical misrepresentation | Provenance and editorial context are core product value | Source-backed editorial review and correction workflow |

## 8. Phase 3 architecture conclusions

The codebase supports the recommended additive architecture without a framework migration or replacement of Firebase. The correct implementation path is:

1. add the dedicated public route family and namespaced modules;
2. establish Firestore public/private boundaries and least-privilege claims;
3. add server-side catalogue publication and rights workflow endpoints;
4. implement the isolated African player only after provider agreements and test assets exist;
5. integrate navigation, service worker and PWA behavior with regression coverage.

No Phase 4 production playback integration is authorized by this audit. This document confirms architecture fit and implementation boundaries; it does not establish any provider rights, partner relationship, playable title or deployment status.

## 9. Source files inspected

- `package.json`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `functions/index.js`
- `functions/package.json`
- `scripts/routes.js`
- `scripts/config.js`
- `scripts/firebase.js`
- `scripts/nav-auth.js`
- `scripts/content.js`
- `scripts/editorial-desk.js`
- `scripts/moderation.js`
- `moderator.html`
- `home.html`
- `scripts/watch.js`
- `scripts/playback/player-engine.js`
- `scripts/playback/tflix-secondary-player.js`
- `scripts/playback/anime-secondary-player.js`
- `scripts/playback/provider-adapters.js`
- `service-worker.js`
- `tests/firestore.rules.test.mjs`
- `.github/workflows/tests.yml`
