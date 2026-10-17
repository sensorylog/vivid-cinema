# Recommendation Engine v2 — Audit, Baseline, and Release Plan

**Status:** implementation branch; automated verification pending.  
**Scope:** For You ranking, taste profile, recommendation retrieval/cache, and deterministic Vivid Recall.  
**Constraints:** preserve the existing local-first data model, typed media identities, static-first architecture, and no Firebase Cloud Functions / Blaze-only dependency.

## Data ownership and inputs

| Signal | Canonical source | Use |
|---|---|---|
| Explicit like / not for me | `scripts/intelligence.js` feedback map | Exact-title inclusion/exclusion and genre-level negative preference |
| Favorites / Watch Later / History | `scripts/library.js` | Recommendation seeds and derived taste |
| Playback progress / completion | `scripts/recommendations.js` | Continue Watching and ranking penalty for unfinished/completed items |
| Viewing behavior | Intelligence bounded event log | Rebuild taste and recency-weighted preference evidence |
| Taste profile | Derived in `scripts/intelligence.js` | Genre, language, country, decade, media, actor and director affinity |
| Catalogue candidates and metadata | `scripts/tmdb.js`, normalized by `scripts/media.js` | Retrieval and explainable catalogue-backed matches |
| Exposure / click memory | Intelligence recommendation memory | Reduce repetitive impressions without interpreting an impression as dislike |

Movies and series retain distinct `movie:<id>` / `tv:<id>` keys. Episode progress retains its episode-specific key. Derived taste is rebuildable; it is not a replacement for the canonical library, feedback, or progress stores.

## Recommendation paths and exclusions

- **For You:** recommendations from recent seeds, genre discovery and language discovery. Excludes items already present in observed library collections and exact `not_for_me` titles. Uses the shared score and diversity-aware reranking.
- **Intent search:** deterministic parsed constraints applied to TMDB discovery. Excludes observed library items and exact dislikes; uses shared scoring without the final diversity pass. Missing catalogue support must be surfaced rather than silently treated as a match.
- **Tonight:** own score over seed recommendations / discovery fallbacks; excludes watched history, disliked titles and session-rejected picks.
- **Because you liked…:** TMDB recommendations around a liked seed; excludes the seed and exact dislikes. It does not currently use every For You exclusion.
- **Continue Watching:** canonical progress store, not the general recommendation scorer.
- **Vivid Recall:** direct remembered-plot retrieval. Deliberately does not hide watched or disliked titles because the user may be trying to identify something they have already seen.

These paths have intentional differences. Shared data identity and feedback semantics are mandatory; exclusion behavior is path-specific and covered by focused tests.

## Main For You score (current v2 branch)

The shared score is an explainable weighted sum. Values below describe the code-level contribution, not a promise of user-perceived relevance:

| Component | Contribution |
|---|---:|
| Preferred genre affinity | capped accumulated genre signal × 5.4 |
| Preferred media type | bounded signal × 1.9 |
| Original language | bounded signal × 0.55 |
| Country | bounded signal × 0.35 |
| Release decade | bounded signal × 0.30 |
| Available cast affinity | bounded actor signal × 1.1 |
| Available director/creator affinity | bounded signal × 1.25 |
| Catalogue rating | normalized 0–1 × 1.4 |
| Popularity | normalized logarithmic 0–1 × 0.8 |
| Explicit like | +6 |
| Recent genre overlap | up to +1.5 |
| Freshness | up to +0.55 |
| Repeated exposure | recency-decayed penalty, capped at 5 |
| Click recovery | bounded below the exposure penalty |
| Playback progress | 1.2–5 penalty for unfinished progress; 10 for completed movie |
| Genres on disliked feedback | soft penalty capped at 5; exact dislikes remain excluded |

Cast/crew preference is used only when candidate metadata actually contains credits. The engine does not issue a per-candidate credits request or infer missing credits. Diversity reranking then limits dominant-genre repetition and balances media type while preserving strong matches.

## Cache and invalidation

- Personalized results cache: `vivid:for-you:v1`, 30-minute TTL.
- Cache fingerprint includes feedback, progress, recent history, all observed library collections, recommendation-memory counters/timestamps, taste update time, daily rotation, scorer version and requested result limit.
- Cache reads validate version 4; older score payloads are invalidated.
- TMDB has separate in-memory and session-storage response caches. Session responses have a five-minute TTL; in-memory entries are bounded by count. These caches must not be confused with ranking freshness.
- Service-worker shell cache bumped to `vivid-cinema-shell-v199` so installed clients can receive the changed ranking code.

## Baseline and evaluation protocol

Do not claim improvement solely from a passing unit test. Use fixed candidate fixtures and fixed profile snapshots to compare old/new ordering:

1. Cold start with no signals.
2. Strong genre preference with language/country ties.
3. Conflicting genre likes and dislikes.
4. Actor/director affinity when credits are present and absent.
5. Recent exposure vs. stale exposure and click recovery.
6. In-progress, near-complete and completed playback.
7. Same numeric movie/TV ID and separate TV episode progress.
8. Account A → B → guest owner transitions and stale asynchronous responses.
9. Cache requests at different limits, stale scorer versions and changed feedback.
10. Recall descriptions with multiple independent clues, including a repeated day plus a distinctive object.

Record:
- **Exclusion correctness:** disliked/observed items excluded on the surfaces that require it.
- **Precision@K / NDCG@K:** only when fixture relevance labels are explicitly authored; do not fabricate relevance labels from the algorithm's own output.
- **Coverage:** distinct titles and media types represented.
- **Genre diversity:** unique genres and dominant-genre share in top K.
- **Stability:** repeated runs over fixed inputs yield identical ordering, except for explicitly time-dependent signals held at a fixed test clock.

The existing repository tests are regression guards, not yet a measured production relevance benchmark. Baseline quality metrics remain unclaimed until fixed labelled fixtures are added and recorded.

## Known release gates

- The current main-branch CI previously had one Recall ordering regression: `Click` should outrank `Groundhog Day` for a description containing both a repeating day and a magic remote. The v2 branch adjusts independent-clue weighting; the test must pass in CI before merge.
- Run the full repository suite, syntax/static validation, and Firestore rules emulator.
- Verify cache upgrade from v198 to v199, offline shell assets, and direct For You navigation.
- Manually test desktop and mobile browsers, guest mode, account switching, empty/error/retry states, feedback refresh and real configured Firebase sync.
- CI success does not prove deployed Firebase behavior or two-device synchronization.

## Non-goals

No Cloud Functions, Blaze requirement, paid AI endpoint, duplicate library/progress store, fabricated metadata, or change to canonical public routes. Vivid Recall remains deterministic and local; stronger matching is heuristic catalogue ranking, not a trained AI model.


## Vivid Recall follow-up hardening

The follow-up branch improves deterministic plot recall without claiming semantic-AI behavior:

- Narrowly normalizes common synopsis wording such as “magic” / “magical” and uses conservative morphological matching.
- Triggers a wider search when the first pass returns fewer than three plausible candidates or weak top evidence.
- Scans pages 1 and 2 of the same constrained movie/TV discovery query and merges candidates with the first pass before reranking.
- Adds regressions where a distinctive object clue must outrank a generic time-loop overlap and where sparse results must trigger the wider fallback.

The broader scan is still bounded by TMDB pagination and its available synopsis/keyword metadata. It does not guarantee finding every title, and unsupported plot details are not treated as verified facts.
