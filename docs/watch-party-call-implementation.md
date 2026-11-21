# Watch Party Call implementation plan

Status: implementation in progress on PR #501. Playback admission, the LiveKit token endpoint/client controls, and the persistent lobby screening shell are now implemented. Real LiveKit connectivity still requires project-owner Cloudflare configuration and end-to-end validation.

## Product behavior

A Watch Room is one shared session, not a collection of independent movie players.

1. Members enter the room lobby and join the voice call.
2. The host chooses a title and a room-compatible player.
3. The host starts the screening. Guests' local players must remain paused while the host is waiting or the screening is paused.
4. A guest explicitly joins the screening. The guest's player then follows the authoritative room clock.
5. Late joiners load the active screening and current playback snapshot; they do not start at zero or begin playing independently.
6. Host playback commands are authoritative. Guest controls are either disabled or explicitly delegated by the host.
7. Voice and movie playback are separate media tracks: a user can mute their microphone without affecting the movie, and playback controls never affect voice.

## Playback admission and synchronization

- The room's selected title, episode, player and provider are session state.
- A guest player is held paused until the guest explicitly joins. The client must issue pause on player readiness and when no host playback snapshot exists; provider autoplay must never create an independent guest session.
- A guest who has not joined must not execute remote play commands. Once joined, they follow the host's timestamped state and drift correction.
- Paused and ended snapshots must issue pause regardless of the guest's locally observed status; iframe status events are not guaranteed to arrive before the room snapshot.
- Only adapters with verified parent-frame command and event contracts are eligible. Unsupported providers are clearly marked and cannot be selected as synchronized room players.
- Browser autoplay restrictions remain respected: the member's explicit Join action is the user gesture that permits playback to begin.

## Voice architecture

Use an SFU-backed voice room, not peer-to-peer full mesh. Watch Rooms currently allow up to 12 members; mesh upload bandwidth and connection count grow rapidly with participant count.

Preferred implementation: LiveKit Cloud / LiveKit SFU with the livekit-client browser SDK.
- Room name is derived server-side from the private Watch Room ID.
- A trusted API endpoint verifies the Firebase identity, App Check, active room membership and room status before issuing a short-lived LiveKit access token.
- Token grants are scoped to the one room and the member's own identity. No client receives the LiveKit API secret. Host room closure, member removal and member leave use a one-minute room-admin token on the server to evict active LiveKit participants.
- Microphone publish and room subscribe are granted to active members. Room closure or membership removal prevents future token issuance; short token lifetime bounds stale access.
- The client provides join/leave, mute/unmute, participant presence and speaking indicators. Microphone permission denial and device errors must be visible and recoverable.
- Voice must fail independently: if LiveKit is not configured or unavailable, the room's text and movie experience remains usable and the UI reports voice unavailable.

Required Cloudflare Pages environment secrets/variables:
- LIVEKIT_URL (public WebSocket endpoint, e.g. wss://...)
- LIVEKIT_API_KEY (secret)
- LIVEKIT_API_SECRET (secret)

The LiveKit account/project and its credentials must be provisioned by the project owner. In Cloudflare Pages → Vivid Cinema → Settings → Variables and Secrets, add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET for the production environment and the PR preview environment used for validation. Store LIVEKIT_API_KEY and LIVEKIT_API_SECRET as encrypted secrets. Never commit credentials or place the API secret in browser code. Until those server-side values exist, voice join reports that voice is not configured; text and screening remain available.

The browser currently loads the pinned livekit-client 2.15.6 ESM build from jsDelivr. The site CSP allows LiveKit Cloud WebSocket/API hosts and microphone access for the same-origin room page; custom LiveKit domains must be added to the connect-src policy. If the project later adopts a local browser bundling step, move this dependency into that build rather than leaving it as a remote import.

## Delivery sequence

### A. Playback correctness (current PR)
- Hold guest playback until explicit admission.
- Pause on player readiness and when the room has no active host playback state.
- Keep guests from executing host play commands before they join.
- Add focused regression tests for the playback admission policy.

### B. Voice foundation (implemented on PR #501; awaiting credentials and live validation)
- Server-side LiveKit token operation reuses Firebase ID-token and App Check verification, then checks active Watch Room membership before issuing a 10-minute room-scoped JWT.
- Token permissions are restricted to microphone publishing, subscribing and data; the API secret stays server-side.
- Pinned browser SDK and lobby controls cover join/leave, mute/unmute, participant roster, speaking state, reconnect state and permission errors.
- Focused tests cover signature, room scoping, identity, expiry and UI/API wiring.
- Voice remains optional until the project owner configures LiveKit credentials.

### C. Unified room experience (first implementation on PR #501; further validation remains)
- The lobby now owns a persistent call panel and an embedded Vivid watch page. Voice remains available beside the player instead of disappearing on a lobby-to-watch navigation.
- Host's Start Screening action loads the selected title in the embedded room player. Guests can open the active screening from the room panel and explicitly join synchronized playback.
- The existing server-authoritative playback clock and guest admission controls remain in force.
- Remaining validation: reconnect, late join, host pause/seek, member removal and room close across browser, PWA, Electron and Android WebView. Add explicit voice moderation controls and server-side LiveKit participant eviction before treating room moderation as complete.

## Non-goals and safeguards

- No claim of frame-perfect playback across third-party providers.
- No attempt to bypass provider autoplay policies, ads, DRM or embed restrictions.
- No peer-to-peer full mesh voice implementation for 12-member rooms.
- No public room discovery or unauthenticated room access.
- No LiveKit secret in client bundles, Git history or logs.
- Netlify is not part of the deployment target; Cloudflare Pages remains the production frontend.