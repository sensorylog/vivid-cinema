# Vivid Memory — Phase 1 Storage and Sync Contract

**Status:** Phase 1 implementation contract  
**Scope:** Existing local-first Library, playback progress, and Intelligence data.  
**Constraints:** No new backend, Cloud Functions, Blaze-only dependency, or duplicate library/progress store.

## Ownership and local keys

Each store keeps its existing canonical active key and a separate owner marker. The shared helper in `scripts/local-owner.js` snapshots each active key under `<key>:user:<uid>` or `<key>:guest`.

| Store | Active data | Owner marker | Snapshot contents |
|---|---|---|---|
| Library | `vivid:library:v2` | `vivid:library-owner:v1` | Favorites, Watch Later, History |
| Library deletions | `vivid:library-tombstones:v1` | same Library owner marker | Per-item deletion timestamps |
| Playback progress | `vivid:progress:v1` | `vivid:progress-owner:v1` | Resume points and completion state |
| Recommendation cache | `vivid:for-you:v1` | same progress owner marker | Derived, expiring recommendation results |
| Tonight session | `vivid:tonight:v1` in `sessionStorage` | `vivid:tonight-owner:v1` | Session-only rejected picks |
| Intelligence | `vivid:intelligence:v1` | `vivid:intelligence-owner:v1` | Feedback, feedback-deletion tombstones, bounded behavior events, taste profile, onboarding |
| Intelligence session | `vivid:session:v1` | same Intelligence owner marker | Session identifier |
| Taste cache | `vivid:taste:v1` | same Intelligence owner marker | Derived taste profile cache |

### Account transition policy

- **First sign-in on a device:** preserve a guest snapshot and let the signed-in account inherit the current local-first state when it has no prior account snapshot.
- **User A → User B:** save A's active snapshot, restore B's snapshot, and initialize missing B stores to empty. Do not combine two authenticated accounts' snapshots.
- **Sign-out:** save the signed-in snapshot and restore the guest snapshot (or an empty store if no guest snapshot exists).
- **Guest → an account with a prior snapshot:** restore that account's snapshot rather than mixing guest data into a partially existing account snapshot.
- **Partial snapshots:** if any incoming account snapshot exists, missing stores are initialized empty. This avoids leaking data from the outgoing owner into the incoming account.
- Snapshot keys preserve the Library's existing `:user:<uid>` naming convention. No existing canonical active key is renamed.

## Data semantics

### Library

The existing Library module remains the source of truth for Favorites, Watch Later, and History. Library entries use typed `movie:<id>` / `tv:<id>` identities. Deletion tombstones remain timestamped so an older remote item cannot silently reappear after a successful sync.

### Playback progress

The existing `vivid:progress:v1` map remains canonical for resume/completion state. Each record contains the title identity and available playback fields: progress seconds, duration seconds, percentage, completion flag/timestamp, optional season/episode, title, and `updatedAt`. Episode-specific keys remain distinct; do not collapse a series' separate episode resume points into one title-level progress record.

- Saving progress is local-first and calculates a bounded percentage from progress and duration.
- Explicit completion marks the record complete and removes it from the resume query without deleting the saved completion record.
- A delayed remote write is bound to the owner active when it was queued. Account changes cancel pending timers and clear in-memory pending writes.
- A reconnect triggers a retry/merge. Local progress absent remotely is queued for upload; newer remote records replace older local records.
- The playback source must be validated by the existing watch controller before it records progress. This phase does not treat title opens as watched progress.

### Intelligence

The existing Intelligence record stores explicit feedback, a derived taste profile, onboarding state, and a bounded list of up to 300 local behavior events. A `feedbackCleared` timestamp tombstone remains locally available when a user removes feedback; this lets a later sync propagate the deletion rather than resurrecting an older remote like.

- Feedback and taste profile are owner-scoped in Firestore under `users/{uid}/feedback/{contentId}` and `users/{uid}/taste/profile`.
- The client emits `vivid:sync-status` events for intelligence cloud-write/sync success and failure. Local state remains authoritative for immediate UI response; the next auth sync or reconnect retries local feedback/taste reconciliation.
- Behavior events remain device-local for recommendation learning. Firestore rules intentionally do not allow reading the events collection, so Phase 1 does not claim cross-device event-history personalization.
- Remote writes are guarded against an account switch between starting and completing an asynchronous operation.

## Remote paths and conflict policy

| Data | Remote path under `users/{uid}` | Merge policy |
|---|---|---|
| Favorites | `favorites/{movie:<id> or tv:<id>}` | Newest `updatedAt`, deletion tombstones win unless an item is newer |
| Watch Later | `watchLater/{movie:<id> or tv:<id>}` | Same as Favorites |
| History | `history/{movie:<id> or tv:<id>}` | Same as Favorites |
| Library deletion tombstones | `libraryTombstones/{collection:<contentId>}` | Newest `deletedAt` |
| Progress | `progress/{existing progress key}` | Newest `updatedAt`; remote wins positive timestamp ties; episode keys stay separate |
| Feedback | `feedback/{movie:<id> or tv:<id>}` | Newest `updatedAt`; remote wins timestamp ties; `kind: "cleared"` is a deletion tombstone |
| Taste profile | `taste/profile` | Newest `updatedAt`; profile is rebuildable from canonical signals |
| Behavior events | `events/{sessionId_eventId}` | Write-only in rules; device-local reads drive ranking |

Library sync uses server-only collection reads and does not replace the local snapshot until the required cloud operations succeed. Progress and Intelligence retain local-first state when a remote operation fails; the UI must not claim a remote sync is confirmed merely because a local write succeeded.

## Validation and limits

The Phase 1 test suite covers owner snapshot transitions, partial snapshots, movie/TV and episode-key separation, resume/completion behavior, account-switch guards, sync lifecycle, and the existing regression suite. CI also runs Firestore rules tests.

Source/unit tests do not prove live Firebase cross-device behavior. A real two-device test against the configured Firebase project is still required before claiming production cross-device reliability. No Cloud Functions, Blaze-only service, or paid AI endpoint is required.
