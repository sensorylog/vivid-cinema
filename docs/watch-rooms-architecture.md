# Vivid Watch Rooms — Engineering Architecture

Status: Stage 2 UI committed; Stage 3 trusted backend and authorization implementation in progress.
Repository: sensorylog/vivid-cinema
Base branch: main
Feature branch: feature/watch-rooms

## Product decisions

- Watch Rooms is available only to signed-in Vivid users.
- Reuse the existing Firebase Authentication instance and Firebase UID. Do not create a second account or profile system.
- Every Watch Room is private and invitation-based. There is no public room directory or public room discovery surface.
- Cinema Clubs are included in the initial product. A club persists across multiple screenings; a screening may also exist independently of a club.
- The primary entry point is a compact Watch Rooms icon in Vivid's shared top navigation.
- Do not add an eighth mobile bottom-navigation destination. Preserve Home, Browse, For You, Live, Library, News and Search.
- Reuse Vivid's existing catalogue and player integration.
- Only claim synchronized playback for provider adapters whose control and event APIs have been verified.

## Repository findings (main)

- The application is a static multi-page HTML/CSS/JavaScript ES-module application.
- The shared navigation is rebuilt by scripts/app-shell.js. Desktop navigation is built in syncDesktopNavigation()/buildPrimaryLinks(); mobile navigation is built separately in syncMobileNavigation(). Adding markup only to home.html will not survive shell rebuilds.
- home.html uses body[data-vivid-page] and loads scripts/app-shell.js. New feature pages should follow the existing page-shell conventions.
- Firebase is initialized in scripts/firebase.js and exports the shared app, auth and db instances. Firebase Auth persistence is already configured there.
- scripts/nav-auth.js and scripts/app-shell.js observe Firebase auth state and dispatch vivid:auth-ready. The feature must use the existing auth instance and must not introduce a competing auth listener or auth implementation unnecessarily.
- Firestore rules are in firestore.rules and end with a deny-by-default catch-all. New room/club paths require explicit, narrow rules and emulator tests.
- The existing Cloud Functions package is under functions/, uses Node 22 and Firebase Functions v2. functions/index.js currently contains trusted callable/scheduled functions; firebase.json configures the functions codebase as news-ingestion. Any new trusted room operations must respect this deployment layout and avoid accidental changes to existing functions.
- Movie playback is implemented in scripts/watch.js. It uses multiple third-party iframe providers and a direct player path. Provider capabilities are not uniform; some embedded providers do not report events to the parent, and custom embeds explicitly leave controls/status to the provider.
- scripts/watch.js already validates provider postMessage origins for selected providers. Any new adapter must retain strict source-window and origin validation.
- Unit tests use Node's test runner. Firestore rules tests use @firebase/rules-unit-testing. Browser route/navigation tests use Playwright.
- Vivid also targets PWA, Electron and Capacitor/Android. New feature code must be compatible with the supported browser shell and avoid browser-only assumptions that break packaged WebViews.
- CSS is split across many stylesheets. Keep new feature styles scoped under a dedicated namespace and avoid broad global overrides.

## Conceptual domain model

These are domain concepts, not a final Firestore schema. Exact paths and fields must be finalized with the rules and query patterns before implementation.

### Room

- id, name, hostUid, optional clubId, selected title, lifecycle status, createdAt, expiresAt.
- Private membership list keyed by Firebase UID.
- Invitation records with securely generated, revocable and expiring tokens; store token hashes where practical rather than reusable plaintext secrets.
- Playback state is ephemeral/realtime where possible; persist only intentional checkpoints and screening metadata.

### Stage 3 Firestore schema

- `rooms/{roomId}`: server-created room metadata, host UID, lifecycle status, member count and expiry.
- `rooms/{roomId}/members/{uid}`: server-created membership and role records.
- `cinemaClubs/{clubId}`: persistent club metadata, owner UID, status and member count.
- `cinemaClubs/{clubId}/members/{uid}`: server-created membership and role records.
- `users/{uid}/watchRooms/{roomId}` and `users/{uid}/cinemaClubs/{clubId}`: private, server-maintained dashboard indexes.
- `watchInvitations/{sha256(code)}`: server-only invitation metadata; plaintext invite codes are returned once and never stored.
- Room invitations expire after 48 hours, are revocable, and have a bounded use count. Room membership is capped at 12; club membership at 100.

### Cinema Club

- id, ownerUid, name, description, image metadata, createdAt.
- Membership and role records keyed by Firebase UID.
- Shared watchlist, voting state, screening references and club activity.
- Club membership is distinct from room membership. A club member is not automatically a live room participant unless they join that screening.

### Screening

- A room session may reference a club, but club membership does not require every screening to be club-linked.
- Preserve history after a room closes; do not use room presence records as durable screening history.

## Stage 3 trusted operations

Callable operations: `createWatchRoom`, `createCinemaClub`, `createWatchInvitation`, `redeemWatchInvitation` and `revokeWatchInvitation`. These operations reject signed-out and anonymous identities, validate bounded inputs, and perform related document changes in Firestore transactions. Clients cannot create or modify room, club, membership, dashboard-index or invitation documents directly.

## Security model

- All room and club entry points require a real Firebase-authenticated user; anonymous Firebase identities are not accepted for this feature.
- Validate room and club membership on every read/write path, not only in frontend routing.
- Use trusted server-side operations for invitation redemption, secure code generation, privileged host actions and any operation that cannot be safely authorized with Firestore rules alone.
- Bound user-controlled strings, list sizes, message lengths, queue sizes, membership counts and update rates.
- Prevent clients from forging hostUid, member roles, invitation state, room lifecycle transitions or other privileged fields.
- Use explicit allow-lists for mutable fields and immutable ownership/creation fields.
- Add Firestore emulator tests for signed-out denial, cross-user denial, non-member denial, valid member access, host-only operations, invite expiry/revocation and malformed payloads.
- Presence must have a lease/heartbeat or expiry strategy and must not be treated as proof of durable membership.

## Realtime and playback design

- Separate durable Firestore records (clubs, memberships, invitations, screening history) from high-frequency ephemeral state (presence and playback clock).
- Choose the realtime transport after measuring current Firebase configuration and deployment support. Avoid writing every playback heartbeat to durable Firestore documents.
- Define a playback adapter contract around capabilities such as play, pause, seek, current position, duration, event subscription and provider identity.
- A provider is sync-capable only when it exposes the required controls/events and passes provider-specific integration tests.
- For unsupported providers, show an explicit compatibility limitation; do not simulate synchronization or promise perfect sync.
- Use an authoritative room playback state with timestamps, drift thresholds, rate-limited corrections, reconnect snapshots and host-transfer rules.

## Navigation and page integration

- Add the Watch Rooms entry through the shared navigation builder in scripts/app-shell.js, not by editing only static page markup.
- Add the compact icon to the shared top-bar tools region so it remains reachable on mobile when text navigation links are hidden.
- Preserve the seven existing mobile navigation items exactly.
- Add a home-page shortcut as a secondary entry point, not a replacement for the top-bar icon.
- The feature route must resolve auth before rendering private room/club data. Signed-out users should be redirected to Vivid's existing auth page with a safe return path.
- The feature must provide loading, empty, error, expired-invite, unauthorized and offline states.

## Seven-stage delivery plan — one pull request

1. Foundation and integration: navigation integration, authenticated route/page foundation, scoped styles, architecture contracts and baseline safeguards.
2. Watch Rooms and Cinema Clubs UI: dashboard, create/join room flows, club dashboard, create club and club details.
3. Backend and permissions: data model, trusted operations, invitation lifecycle, Firestore rules and rules tests.
4. Lobby and social: room membership/presence, queue, voting, chat, reactions and host controls.
5. Synchronized cinema: verified provider adapters, playback authority, sync protocol, drift correction and reconnect handling.
6. Complete cinema experience: persistent club watchlists, screening history, After-Credits ratings and discussions.
7. Hardening and release validation: security review, cross-platform/browser checks, performance and regression testing.

Each stage is delivered as focused commits on feature/watch-rooms and reviewed before continuing. The same pull request remains open throughout all seven stages. Work stops after each stage until the product owner explicitly says “next”.

## Validation and baseline

- Record the current main CI result before feature-specific failures are attributed.
- Run focused unit and rules tests for each stage, plus syntax checks.
- Run the full npm test and npm run check:syntax gates at planned integration checkpoints.
- Use Playwright for page routing, navigation, signed-out gating and responsive behavior.
- Verify PWA, Electron and Android/Capacitor build compatibility where the available CI/device environment permits.
- Do not report a test, build, emulator or device check as passing unless its actual result is captured.
- Known historical audit baseline: 477 passing tests and seven reported failures among 485 reported tests; this historical result has not been independently rerun against the current main HEAD.

## Scope exclusions

- No eighth bottom navigation item.
- No public room discovery.
- No separate authentication/profile system.
- No duplicate movie catalogue or unrelated playback rewrite.
- No broad CSS cleanup or unrelated refactoring.
- No claim of universal synchronization across unsupported embedded providers.
- Do not modify the existing Android foundation pull request as part of this work.