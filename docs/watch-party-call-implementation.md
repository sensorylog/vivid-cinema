# Watch Party Call implementation plan

Status: in progress. This document is the implementation contract for turning Watch Rooms into a shared call and screening experience.

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
- Token grants are scoped to the one room and the member's own identity. No client receives the LiveKit API secret.
- Microphone publish and room subscribe are granted to active members. Room closure or membership removal prevents future token issuance; short token lifetime bounds stale access.
- The client provides join/leave, mute/unmute, participant presence and speaking indicators. Microphone permission denial and device errors must be visible and recoverable.
- Voice must fail independently: if LiveKit is not configured or unavailable, the room's text and movie experience remains usable and the UI reports voice unavailable.

Required Cloudflare Pages environment secrets/variables:
- LIVEKIT_URL (public WebSocket endpoint, e.g. wss://...)
- LIVEKIT_API_KEY (secret)
- LIVEKIT_API_SECRET (secret)

The LiveKit account/project and its credentials must be provisioned by the project owner. Never commit credentials or place the API secret in browser code. Until those server-side values exist, voice join must remain disabled with a clear configuration state.

## Delivery sequence

### A. Playback correctness (current PR)
- Hold guest playback until explicit admission.
- Pause on player readiness and when the room has no active host playback state.
- Keep guests from executing host play commands before they join.
- Add focused regression tests for the playback admission policy.

### B. Voice foundation
- Add a server-side LiveKit token operation with membership and App Check validation.
- Add the pinned browser SDK and call controls to the room lobby.
- Show participant roster, microphone state, speaking state, device permission errors and reconnect status.
- Add tests for token claims, room scoping, expiry and authorization boundaries.
- Keep the voice integration optional until the project owner configures LiveKit credentials.

### C. Unified room experience
- Replace the separate lobby-to-watch-page mental model with a persistent room session shell: call roster/controls remain available while the shared movie player is open.
- Host's Start Screening action loads the shared title for every connected member.
- Guests join the active screening from within the call; no manual provider/server matching.
- Add explicit host controls for who can play/pause/seek and who can speak.
- Validate reconnect, late join, host pause, host seek, member removal and room close across browser, PWA, Electron and Android WebView.

## Non-goals and safeguards

- No claim of frame-perfect playback across third-party providers.
- No attempt to bypass provider autoplay policies, ads, DRM or embed restrictions.
- No peer-to-peer full mesh voice implementation for 12-member rooms.
- No public room discovery or unauthenticated room access.
- No LiveKit secret in client bundles, Git history or logs.
- Netlify is not part of the deployment target; Cloudflare Pages remains the production frontend.