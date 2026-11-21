# Vivid Watch Rooms — Engineering Architecture

Status: Stages 1–6 implemented; Stage 7 hardening and release validation in progress. GitHub Actions validation remains pending.
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
- Cloudflare Pages publishes the static frontend from dist/. The repository already has a Vercel serverless API at api/send-verification.js (vivid-cinema-api.vercel.app) using Firebase Admin. Watch Rooms trusted mutations use that existing Vercel API host rather than introducing Firebase Cloud Functions.
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

Trusted API operations: `createWatchRoom`, `createCinemaClub`, `createWatchInvitation`, `redeemWatchInvitation` and `revokeWatchInvitation`. These operations reject signed-out and anonymous identities, validate bounded inputs, and perform related document changes in Firestore transactions. Clients cannot create or modify room, club, membership, dashboard-index or invitation documents directly.

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
## Stage 4 lobby and social implementation

- Presence is represented by short-lived member leases refreshed every 30 seconds and expiring after 90 seconds; it is not a substitute for membership.
- Room queue suggestions are created through trusted API operations, bounded to 50 items, and support per-member vote toggling.
- Room chat is member-only, bounded to 500 characters per message, and rate-limited server-side.
- Reactions are allow-listed and toggled by authenticated room members.
- Host-only settings control the room name and whether guests may add queue items or chat. The host can remove another member, change guest permissions, and close the room for everyone; the host cannot remove themselves.
- Lobby collections are readable only by current room members. All client writes to presence, queue and chat are denied by Firestore rules; mutations use trusted API operations.
- Client lobby listeners are torn down when the user leaves the lobby. Playback synchronization remains Stage 5 and is not implied by the lobby.

## Stage 5 synchronized playback — verified provider adapters and room clock

- VidSrc at the exact origin `https://vidsrc.sh` and CineSRC at `https://cinesrc.st` are the currently enabled synchronization adapters. Both expose parent-frame playback commands and playback events. Vivid validates both the active iframe window and exact provider origin before accepting events or sending commands.
- VidAPI, VidLink and other providers remain available for individual playback, but are not advertised as synchronized until their command and event contracts are independently verified.
- The host is authoritative by default. A trusted API operation rechecks open-room membership, host role, active screening identity and expected playback revision inside the same transaction that updates `rooms/{roomId}/playback/current`. Delegated guest control remains an explicit room setting.
- Members receive realtime read-only playback snapshots. Clients cannot write playback state directly.
- The lobby automatically moves active members into the room's current screening and preloads the selected player while the host is preparing. CineSRC autoplay is disabled in room mode so the host explicitly starts the screening. A guest can tap the provider's Play control once to unlock browser playback; Vivid immediately holds that guest at the room's waiting state, then follows the host automatically when playback begins. This interaction is per viewer and per browser: a host's click cannot grant autoplay permission on another member's device. There is no second manual join action.
- Play, pause, seek, playback-rate and ended events are classified separately from periodic progress heartbeats. Control transitions are committed immediately; only repeated progress heartbeats are rate-limited. A seek or rate change must never be discarded as an ordinary playing heartbeat.
- Playback speed is part of the shared timeline, within the common 0.25×–2× range. CineSRC reports rate changes directly; VidSrc speed is inferred from its periodic position reports and normalized to supported speed steps. Vivid sends the host's rate to the other provider's player controls so guests do not drift simply because they are watching at 1× while the host uses a faster speed.
- CineSRC skip-intro jumps are treated as seek events. Its automatic next-episode behavior and independent episode selectors are disabled in Watch Room mode. If the provider's own in-player next-episode control is used, Vivid pauses the room and reloads the currently shared episode rather than allowing one viewer to drift into a different episode. A new episode must be started as a new shared screening session. Volume and subtitle preferences remain local to each viewer.
- Playback position is estimated from the host event's server-adjusted capture timestamp (validated by the backend) and each viewer's measured client/server clock offset, so API transit time is included. The client also extrapolates its own last observed playback position before comparing drift, avoiding repeated seeks caused by stale event timestamps.
- Guests periodically reconcile against the latest room clock, retry unconfirmed play/pause/seek commands, and fetch a fresh authoritative snapshot after reconnect or returning to a visible tab. Older playback revisions and stale screening sessions are ignored.
- Some browsers and embedded providers block audible autoplay until the viewer interacts with the player. The player is therefore preloaded before the host presses Play, allowing the guest to tap Play once while the room is waiting; Vivid pauses that preparation playback and then applies host commands automatically. If the browser still blocks a remote start, Vivid explains that the viewer must tap Play once. This is a browser/provider restriction, not something a web app can safely bypass.
- Room state is locked to one title and (for TV) one episode. Changing to a different title starts a new screening session.
- Host authority does not transfer automatically. The last trusted snapshot remains available if the host disconnects, but no new host commands are issued until the host reconnects or the room is closed.
- This is provider-assisted synchronization, not a promise of frame-perfect playback. Third-party buffering, network latency, and provider behavior remain outside Vivid's control.


## Stage 6 persistent Cinema Club experience

- `cinemaClubs/{clubId}/watchlist/{itemId}` stores a shared, typed movie/TV watchlist (maximum 100 entries). Items are keyed by typed catalogue identity so a movie and series with the same numeric catalogue ID cannot collide.
- `cinemaClubs/{clubId}/screenings/{screeningId}` stores durable screening history, including typed title identity, screening date, optional notes, and rating aggregates. A member can record a screening from the club page.
- `screenings/{screeningId}/afterCredits/{uid}` stores each member's editable 1–5 rating and optional review. Aggregate rating totals are updated transactionally to avoid lost updates.
- `screenings/{screeningId}/discussion/{messageId}` stores member-only After-Credits discussion messages, bounded to 1,000 characters and 200 messages per screening.
- Trusted trusted API operations perform every write. They require a signed-in, non-anonymous Vivid identity, verify active club membership, and re-check membership inside the transaction that commits durable changes.
- Firestore rules allow only current members of active clubs to read these collections. Client writes are denied; non-members and signed-out users cannot read club watchlists, history, ratings or discussions.
- The club page subscribes to the selected club's shared watchlist and screening history, and loads a screening's ratings/discussion when the member opens its After-Credits view.
- The UI accepts Vivid's typed `movie:ID` / `tv:ID` catalogue identifiers. It does not pretend free-text titles alone are a canonical catalogue match.


## Stage 7 hardening and release validation

- All Cinema Club mutations require a non-anonymous Firebase identity, verify active membership before work, and re-read club status and membership inside the committing transaction.
- Watch Room and Cinema Club Firestore reads require a non-anonymous Firebase sign-in and a current membership record. Cinema Club archive reads additionally require the club status to remain active.
- All room, lobby, playback, watchlist, screening, review and discussion writes remain server-only through the authenticated Vercel API. Firestore client write rules remain denied.
- The club UI disables write forms until a club is selected, restores listeners after back-forward cache navigation, shows live watchlist/screening counts, and links the screening action to the actual club screening form.
- Stage 7 test coverage includes Stage 6 API route contracts, active-club transaction rechecks, member-only archive access, archived-club read denial, and client-write denial.
- Release gate: the latest commit must pass the repository's Tests, Firestore Rules, static validation, browser navigation, Windows and Android workflows. Cloudflare Pages is tracked separately as a deployment check. A queued or in-progress workflow is not considered a pass.
- Known product boundary: synchronized playback is enabled only for the verified VidSrc and CineSRC parent-frame control contracts; it is not frame-perfect and browser autoplay/network buffering remain external constraints.

- Watch Room queue items can be removed by their author or the host. Removal and queueCount decrement occur in the same transaction, so a removed suggestion releases capacity without allowing concurrent overfill.
- Room chat is capped at 500 messages per room with a transactionally maintained counter, in addition to the per-member send cooldown and message-length bound.
- Guests can leave an open room through a trusted transaction that removes membership, presence and the private dashboard pointer. Hosts must close the room rather than orphan it.
- Expiry is enforced by trusted operations, so expired rooms and invitations cannot be used. The dashboard also triggers a best-effort, globally throttled Vercel API retention pass: up to 100 expired invitations and one expired room tree are deleted per pass, including nested subcollections and member dashboard pointers. This avoids a Firebase scheduled function; cleanup is opportunistic rather than an hourly guarantee.
- Anonymous Firebase identities are explicitly denied in the Watch Rooms and Cinema Club rules tests.
- The shared web Firebase client initializes reCAPTCHA Enterprise App Check. The Vercel Watch Rooms API requires Firebase ID-token verification and consumes one-time App Check tokens before performing trusted operations. This is custom API verification; it does not require enabling Firebase Cloud Functions.

- Guests can leave an active Watch Room through a trusted transaction; the host must close the room. Leaving removes the member, presence lease and private dashboard pointer while preserving the host and room.
- Cinema Club members can leave; the owner can archive the club. Both operations are transactionally authorized, update membership counts/pointers, and archived clubs become unreadable under the active-club Firestore rule.
- Watch Room chat is capped at 500 messages per room in addition to per-member rate limiting. Queue items can be removed by their author or the host, with the transactional queue counter decremented.
- Dashboard reads are generation-guarded so a slower response for a previous Firebase user cannot overwrite the current account's room/club list after an auth switch.
- Closed/expired Watch Rooms and expired invitation documents are denied by the API. Physical recursive cleanup is a separate retention task and is not claimed as deployed.

- Invitation redemption, member departure and host removal update the authoritative member count and existing private dashboard summaries in the same transaction. Room and club previews therefore do not retain stale membership counts.
- The service worker precaches the Watch Rooms dashboard, lobby, Cinema Club and playback modules. Its shell cache version is bumped so existing installations fetch the new feature assets on update.

- Room access now fails closed if the parent room lacks a valid Firestore timestamp expiry. The same expiry requirement is enforced in Firestore rules, trusted API membership checks and playback publication.
- Lobby listeners and presence heartbeats are torn down on pagehide and restored on back-forward cache navigation. Hosts can manage both online and offline members, not just currently active presence leases.

- Playback drift calculations use a server-time offset measured from the trusted room heartbeat, reducing dependence on each viewer device's wall clock. Periodic playing updates are throttled without suppressing pause/resume state transitions.


## API hosting migration

- Browser clients call the same-origin `/api/watch-rooms` route through `scripts/watch-room-api.js`.
- Every operation sends the current Firebase ID token in `Authorization: Bearer` and a one-time App Check token in `X-Firebase-AppCheck`. The Cloudflare Pages Function verifies both before dispatch.
- The API reuses the `FIREBASE_SERVICE_ACCOUNT_JSON` Vercel secret already used by `api/send-verification.js`; the service account needs Firebase Auth Admin, Datastore User, and Firebase App Check Token Verifier permissions. It does not create or deploy Firebase Cloud Functions.
- Cloudflare's static build intentionally excludes `api/`; Vercel deploys that directory as serverless API routes, while Cloudflare Pages continues to publish `dist/`. `VIVID_ALLOWED_ORIGINS` must include the production Pages hostname and any custom domain.
- Firestore client writes to Watch Room and Cinema Club records remain denied. Trusted API transactions remain the only mutation path.


## Cloudflare Pages Watch Rooms deployment

- The Watch Rooms API is deployed at `/api/watch-rooms` on the same Cloudflare Pages origin as the site.
- The Pages build runs `automation/build-cloudflare-functions.mjs`, which bundles the isolated `cloudflare/functions` directory into `dist/_worker.js`; the Firebase Functions source under `functions/` is not moved or deployed as Pages routes.
- In Cloudflare Pages, open **Settings → Functions → Compatibility Flags** and enable `nodejs_compat` for both Production and Preview. Use a current compatibility date (2026-08-04 or newer enables Node.js compatibility by default). The route uses Node crypto and Firebase Admin Auth/App Check SDKs.
- Add `FIREBASE_SERVICE_ACCOUNT_JSON` as a Cloudflare Pages secret containing the complete Firebase service-account JSON. Do not commit the JSON or put it in a public Pages variable.
- After the secret and compatibility flag are configured, the client uses the same-origin API path; no Vercel endpoint or Firebase Cloud Function is involved.
