# Vivid Intelligence + Memory — Integrated Feature Audit

**Audit date:** 2026-10-15  
**Scope:** Memory Phase 1, Intelligence MVP Phase 2, Integration/Reliability Phase 3, and Future Module Contracts Phase 4  
**Purpose:** Record code-level findings, the hardening applied after Phase 4, and the remaining release gates.

## Executive result

The feature is structured around the existing local-first Library, typed movie/TV identity, playback-progress store, Memory signals, and deterministic recommendation engine. Phase 4 adds contracts for Vivid Universe and Vivid Night only; neither future module is exposed as a placeholder route.

The audit found several correctness gaps in the Phase 2/3 integration. The accompanying final-audit hardening change addresses the catalogue-filter messaging, mixed-media runtime explanation, partial catalogue failures, ranking-cache freshness, and stale secondary-section responses.

**This is not a production sign-off.** Automated tests cannot establish deployed Firebase sync, provider progress reliability, or real browser/device behavior.

## Code-level audit findings and corrections

### 1. Typed media identity and navigation

- Movies use `movie:<id>`; TV series use `tv:<id>`.
- `normalizeMedia()` supplies `content_id` and `media_type`.
- Title navigation reuses `getMediaUrl()` / `buildTitleUrl()`.
- Phase 4 contract tests protect same-number movie/TV IDs from colliding.
- No Universe/Night placeholder routes or navigation entries were added.

### 2. Intent parsing and filter honesty

- Intent interpretation remains deterministic and client-side; no paid LLM is required.
- TV genre metadata is not identical to movie genre metadata. Combined categories and missing TV categories are now labelled and disclosed rather than silently presented as exact filters.
- Anime-film requests remain movie searches with Japanese-language animation filters.
- A mixed movie/TV runtime limit is described separately as movie runtime and per-episode runtime.
- Meaningful title, trailer, watch, progress, and recommendation-click signals mark the taste profile stale and can seed the next rebuild; impression-only events do not repeatedly invalidate taste.
- A locally dirty taste profile is not replaced merely because a remote profile has a newer timestamp; local device-only behavior signals must be included in the next rebuild.
- Mood, dub/subtitle, and provider availability claims remain explicitly unsupported where catalogue metadata cannot verify them.

### 3. Catalogue failure states

- If every catalogue request fails, the filtered search raises an error and the UI can show its retry state.
- If one media-type request returns useful results while another fails, successful results remain usable.
- If the only successful request is empty while a sibling request fails, the result is treated as a partial failure rather than proof of zero matches.
- A fully successful empty result remains a genuine no-match state.

### 4. Ranking and cache correctness

- The personalized-results cache fingerprint includes feedback, playback progress, recent history, all observed Library collections, taste timestamps, daily rotation, and recommendation impression/click memory.
- A changed recommendation-memory signal can therefore invalidate a cached ranking instead of remaining invisible until an unrelated cache input changes.
- Personalized recommendation, Tonight, and “Because you liked…” reads verify the active owner after asynchronous catalogue work before returning or caching results.
- For You and Home guard stale requests; both clear prior-owner recommendations immediately on account changes, Home refreshes personalized shelves, and Continue Watching clears when the active owner's progress is empty.

### 5. Owner isolation and data semantics

- The shared owner-snapshot policy preserves guest/account snapshots and avoids inheriting another account's missing stores.
- Library, feedback, taste, and playback progress continue using their canonical stores; no competing Memory/progress store was introduced.
- Behavior events are bounded. Under the current Firestore rules, event history remains write-only remotely and local reads drive personalization; cross-device behavior-history replication is not claimed.
- A successful local write is not proof of successful remote sync.

### 6. Phase 4 future-module boundary

- Vivid Universe must use source-backed relationship provenance and typed title references; similarity/recommendation alone is not proof of franchise canon.
- Vivid Night must reuse intent parsing and existing ranking/Memory APIs; runtime matches can only be claimed when metadata supports them.
- Group votes, saved plans, new Firestore collections, and cross-device sessions are not part of this preparation phase.

## Verification status

### Automated checks

The final-audit pull request must pass the repository regression suite, syntax/static validation, and Firestore rules emulator checks before merge. The relevant run results are linked from the pull request.

### Manual release gates still open

- [ ] Desktop and mobile Safari/Chromium: open For You, submit common and unsupported queries, remove individual filters, refresh, retry, and verify empty/error states.
- [ ] Confirm TV approximations and missing-genre notices are understandable and that no result is presented as a verified match for an unsupported mood or provider.
- [ ] Guest flow: open a recommendation, start a trailer, begin/pause/resume playback, and confirm only reliable provider progress is recorded.
- [ ] Verify favorites, Watch Later, history, feedback, progress, and recommendation refresh behavior end to end.
- [ ] On two real devices with the same configured Firebase account, verify library and playback-progress sync; separately verify feedback/taste sync behavior.
- [ ] Switch account A → account B → sign out and confirm no Library, progress, feedback, or taste state leaks.
- [ ] Verify deployed Firestore rules and inspect actual `vivid:sync-status` events for success/failure.
- [ ] Verify service-worker activation, update, offline navigation, and the For You shell assets on real devices.

## Known limitations

- Catalogue metadata cannot reliably express every mood, trope, content warning, dub/subtitle option, or regional streaming-provider availability.
- The TV catalogue does not expose a one-to-one equivalent for every movie genre.
- Cross-device Memory reliability still requires a real two-device test against the configured Firebase project.
- Playback resume depends on validated progress events from the active embed/provider.
- Vivid Universe and Vivid Night are contracts only, not shipped user experiences.

## Final status

**Code-level hardening:** implemented in the final-audit change.  
**Automated verification:** must be green in CI before merge.  
**Production/runtime verification:** pending the manual release gates above.
