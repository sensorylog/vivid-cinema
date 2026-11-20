# Watch Room screening architecture

Status: engineering plan, not a claim that every provider is currently supported.

## Product goal

A host chooses a title from the room queue, starts a screening, and room members join the same title. Where the selected playback provider exposes a documented control API (or Vivid has an authorized direct-stream integration), Vivid synchronizes play, pause, seek, and playback position. Each member retains control over local volume, captions, and device output.

A movie catalogue record is metadata, not a media stream. TMDB supplies title and availability metadata; it does not grant Vivid rights to a movie file or provide a universal playback URL. A screening must use a source the host and participants are entitled to access.

## Findings from the current implementation

- Watch Rooms already have authenticated server operations for membership, invitations, heartbeat, host playback publishing, and room lifecycle.
- The previous playback page read membership and playback state directly from browser Firestore (getDoc / onSnapshot). That creates a second browser-read dependency beside the authenticated Watch Rooms API.
- The current sync adapter is provider-specific. Cross-origin iframe DOM access is not a viable general integration strategy; each provider needs an explicit, documented adapter.
- The room is small (current server limit: 12 members), so a short-interval authenticated snapshot is a safe first transport while correctness is established.
- The lobby repair and playback transport hardening are separate stacked changes. Do not merge or deploy the playback layer ahead of the lobby API it depends on.

## Recommended architecture

### 1. Server-authoritative room state

The server is the source of truth for room membership, host identity, room lifetime, and playback state.

Every read requires:
- a valid Firebase ID token;
- a valid App Check token;
- a non-anonymous Vivid account;
- active membership in an open, unexpired room.

Every playback mutation requires the active host role. Guests cannot publish authoritative playback state. Do not trust a client-supplied role, host UID, room status, or revision.

Playback state should evolve toward this versioned shape:

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "hostUid": "server-verified-user-id",
  "contentId": "TMDB-id",
  "mediaType": "movie",
  "season": null,
  "episode": null,
  "provider": "provider-adapter-id",
  "status": "playing",
  "position": 125.4,
  "playbackRate": 1,
  "updatedAt": 0,
  "commandId": "unique-id"
}
```

The server assigns revisions and timestamps. It validates title identity, position/duration bounds, allowed provider IDs, host authority, and rate limits. Duplicate command IDs are idempotent.

### 2. Transport rollout

**Phase A — authenticated snapshot polling (safe baseline).** Read only the single playback document through the same-origin authenticated API. A 2.5-second poll is an interim fallback, not the final low-latency design. Do not poll the entire lobby document set for playback.

**Phase B — Cloudflare Durable Object WebSocket (target).** Use one Durable Object per room for ordered, low-latency broadcast. Use the WebSocket Hibernation API and SQLite-backed storage so state survives eviction/restarts. Persist the latest authoritative revision before broadcasting. Reconnect clients with a fresh snapshot and resume from the latest revision.

Cloudflare Pages cannot create/deploy the Durable Object class inside the Pages project. The Durable Object must be deployed as a separate Worker and bound to the Pages Function. That requires a separately verified Worker, a production and preview binding, and an intentional deployment/configuration step. Do not add a dangling binding to the existing Pages project or change wrangler.toml until the Worker namespace exists.

WebSocket authentication should use a short-lived, single-room connection ticket minted by the existing authenticated Pages API after Firebase Auth, App Check, and room membership checks. The Durable Object must validate the ticket, room, user, expiry, and allowed role; never trust a room ID alone. A reconnect obtains a new ticket. Do not send Firebase service-account credentials or long-lived Firebase tokens into the Durable Object.

### 3. Provider adapter contract

The sync engine must not inspect arbitrary cross-origin iframe DOMs or guess undocumented postMessage formats. Each supported adapter must expose:

- getIdentity(): stable media identity, including episode identity where relevant;
- getState(): status, current time, duration, playback rate, and readiness;
- play(), pause(), and seek(seconds);
- subscribe(callback) and dispose();
- an explicit capability declaration (for example, whether programmatic play or seeking is supported).

Initial supported adapter candidates:
- **Authorized native HTML video**: the existing Vivid direct-stream player, only when its resolver returns an HTTPS URL from the configured allowlist.
- **YouTube**: official IFrame Player API for eligible embeddable videos; embedding can be disabled by the rights holder and autoplay may be blocked.
- **Vimeo**: official Player SDK for videos whose owner settings permit embedding and control.

A provider with no documented player API is display-only for Watch Rooms. Do not claim synchronized controls for Netflix, Prime Video, or arbitrary external embeds. Their DRM, account, and platform controls are not exposed as a universal third-party API.

### 4. Synchronization algorithm

- The host is the only authoritative playback clock.
- Estimate server clock offset using request midpoint / round-trip time; use server timestamps, not device wall-clock assumptions.
- Extrapolate expected position from the last server timestamp while status is playing.
- Correct only meaningful drift (initial target: seek above 1.5–2 seconds); avoid seeking on every progress event.
- If an adapter supports safe rate adjustment, gently correct medium drift and return to 1x after convergence. Never assume every provider supports rate control.
- Tag remote commands with revision/command ID so resulting player events do not echo back as new host commands.
- Buffering on one guest must not pause everyone. Offer a guest “I'm behind” resync action.
- If browser policy rejects scripted playback, show a clear **Ready to Watch / Tap to Start** action. A remote command cannot bypass a user gesture requirement.
- A title or episode mismatch must stop synchronization and explain how to open the correct item.

### 5. Screening flow

1. Host selects a queued title and taps **Start Screening**.
2. Server validates host membership and the selected queued item, then marks it as the room's active title and creates a screening session ID.
3. Members receive the active title and navigate to the same Vivid title route with the room/session context.
4. Each device selects or confirms a supported source and taps **Ready to Watch** if required by its browser/provider.
5. Host starts playback; the server publishes a versioned state; all ready members synchronize.
6. Reconnect restores the latest room state. Leaving the screening does not delete the room or queue.

The selected source must be available to each viewer independently. Vivid should show source/region availability where reliable data exists, but never imply that a catalogue listing grants access.

## Security and reliability invariants

- Preserve Firebase Auth, App Check, server-side membership checks, host-only writes, room expiry, invitations, and rate limits.
- Do not expose service-account credentials, private source URLs, or provider secrets to guests.
- Never allow guests to overwrite host state by editing Firestore directly.
- Keep lobby member/queue/chat loading independent from playback polling.
- Use bounded polling with in-flight deduplication and backoff on failures; stop all timers on leave, sign-out, room switch, and page teardown.
- Do not change production Cloudflare bindings, deploy a new Worker, or alter room Firestore rules without a separately tested migration and preview.

## Test plan before production

- Two iPhones / mobile browsers: host start, guest ready, play, pause, seek, end.
- Host and guest on different networks and with meaningful clock skew.
- Autoplay rejected; guest must tap Ready to Watch and then resync.
- Slow network, packet loss, reconnect, tab background/resume, and page refresh.
- Host leaves, guest leaves, guest is removed, room expires, and room is deleted.
- Wrong movie, wrong TV season/episode, unsupported provider, and provider iframe disabled.
- Duplicate and out-of-order commands; stale revision; concurrent host action.
- Ensure a guest cannot publish, change host identity, or read another room's state.
- Load test with the current 12-member room cap before enabling WebSockets broadly.

## Official technical references

- Cloudflare Pages bindings and Durable Object requirement: https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare WebSocket Hibernation API: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare SQLite-backed Durable Object storage: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- Vimeo Player SDK reference: https://developer.vimeo.com/player/sdk/reference
- Browser playback gesture/autoplay behavior: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
- TMDB API scope and attribution: https://developer.themoviedb.org/docs/faq
