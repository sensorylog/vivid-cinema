# Phase 3 — Integration & Reliability

**Status:** Implementation and automated regression coverage in progress  
**Scope:** Connect existing Memory and Intelligence signals, harden recommendation invalidation, and record the manual validation still required.  
**Constraints:** Static-first architecture; no Cloud Functions, Blaze-only dependency, paid AI service, or duplicate Library/progress store.

## Implemented in this phase

- Title-detail renders record a bounded `title_opened` behavior signal. The existing event deduplication window prevents the lightweight and enriched title render from producing duplicate events.
- Starting a trailer records `trailer_started`; clicking a recommendation on a title page records `recommendation_clicked`.
- Existing Watch integrations continue to record playback start, progress, and completion into the existing Intelligence and Memory modules.
- The personalized recommendation-cache fingerprint now includes all observed Library entries (Favorites, Watch Later, and History), not just the most recent History items. This prevents a stale cache from surviving a favorite/watch-later change.
- A dedicated integration regression test checks title/trailer/click signals, playback integration, bounded event storage, cache inputs, stale-request guards, canonical change listeners, and the versioned offline shell.

## Automated validation

Run these in the repository environment:

```sh
npm test
npm run check:syntax
npm run test:rules
```

A green static/unit suite verifies code-level contracts only. Firestore rules tests require the configured Firebase emulator tooling. This document does not claim that these commands have run in this work session.

## Manual release checklist

- [ ] Guest flow: open For You, open a recommendation, start a trailer, begin playback, pause, resume, and complete a title where the player reports reliable progress.
- [ ] Verify title/trailer/playback actions change local Intelligence signals without duplicate event spam.
- [ ] Verify a new Favorite, Watch Later item, removal, feedback change, and progress update produce fresh recommendations or immediately exclude relevant items.
- [ ] Verify recommendation requests finishing out of order never replace the latest query's results.
- [ ] Verify Home, Discover, Title, Watch, Library, Account, authentication, and PWA/offline shell still load on desktop and mobile Safari.
- [ ] Verify Firestore rules reject cross-user access and invalid oversized event payloads.
- [ ] On two real devices using the same configured Firebase account: favorite a title on device A, confirm it on device B; save progress on A, confirm resume state on B; change feedback on B, confirm recommendations react on A after refresh/re-entry.
- [ ] Switch account A → account B → sign out; confirm no Library, progress, or Intelligence state leaks across owners.
- [ ] Capture the actual CI run, browser/device results, and any sync-status failures before claiming production reliability.

## Known limits

- Behavior events remain device-local for personalization under the current Firestore rules; Phase 3 does not claim cross-device behavior-history replication.
- Real playback progress depends on the active provider emitting validated events. An unsupported or silent player cannot be treated as proof of watched progress.
- A successful local write is not proof of a successful remote sync. Use the existing `vivid:sync-status` events and server-confirmed account sync to assess cloud state.
- No two-device Firebase test is asserted by this implementation change.
