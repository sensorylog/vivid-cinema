# Phase 4 — Future Module Contracts: Vivid Universe + Vivid Night

**Status:** Contract and architecture preparation only  
**Depends on:** Memory Phase 1, Intelligence MVP Phase 2, integration/reliability Phase 3  
**Constraints:** Static-first; reuse the current TMDB client, typed title identity, Library, Memory, and recommendation engine. No Cloud Functions, Blaze-only dependency, paid AI service, duplicate progress/library store, or premature navigation entry.

## Purpose

Phase 4 makes the next two product areas possible without implementing empty pages or speculative abstractions:

- **Vivid Universe** — explore evidence-backed relationships between films and series, including franchises, related titles, and watch-order guidance.
- **Vivid Night** — turn a viewing intention into a practical shortlist or group plan, using known runtimes, the user's stated constraints, and existing Intelligence/Memory signals.

This phase defines their integration contracts. It does not ship either experience or add either one to primary navigation.

## Shared contracts

### 1. Canonical media identity

Use the existing media normalizer as the identity boundary:

- A movie identity is `movie:<TMDB id>`.
- A TV identity is `tv:<TMDB id>`.
- `normalizeMedia()` exposes this as `content_id` and retains the typed `media_type`.
- Use `getMediaUrl()` or `buildTitleUrl()` for title links. Do not hand-build title URLs or use an untyped numeric ID as a cross-media key.

A franchise, person, collection, season, or episode is a related entity—not a movie/TV title identity. If one of those entities is introduced, give it an explicit entity type and namespace rather than forcing it into the movie/TV key.

### 2. Metadata and relationship provenance

Both future modules must use `scripts/tmdb.js` as the single catalogue transport and `scripts/media.js` to normalize movie/TV results.

Every displayed relationship should be traceable to one of:

1. Explicit TMDB metadata (for example, a known collection membership or an API-provided relationship).
2. A documented deterministic rule applied to source metadata (for example, ordering known collection entries by release date).
3. A clearly labelled recommendation, which is not a confirmed franchise relationship.

Do not infer shared universes from similar titles, shared cast, posters, genres, or recommendation results alone. Similar/recommended titles are useful discovery signals, not proof of canon. If source data is missing or ambiguous, label the relationship as unknown or omit it.

The current TMDB wrapper already exposes typed movie/TV details, similar titles, recommendations, season details, and search/discover methods. It does **not** yet expose a complete cross-media franchise graph or a general collection-details contract. Add narrowly scoped methods to the existing wrapper only when a concrete Universe screen needs them; do not introduce a second API client.

### 3. Memory and Intelligence integration

Future modules consume existing state; they must not create parallel stores for favorites, Watch Later, History, playback progress, feedback, or taste:

- Library: `getLocalLibrary()`, `upsertLibraryItem()`, `removeLibraryItem()`, and the existing collection APIs.
- Feedback and signals: `getFeedback()`, `setFeedback()`, and `recordBehavior()`.
- Taste and recommendation memory: `getTasteProfile()`, `getRecommendationMemory()`, and the existing recommendation functions.
- Playback progress and Continue Watching: the current `scripts/recommendations.js` progress APIs.

Use the existing change/invalidation events rather than maintaining an independent cache that can go stale. Keep behavior events bounded and device-local unless a separately reviewed, rules-compatible sync design changes that explicit contract. A local write or a green unit test is not evidence of cloud sync.

### 4. Vivid Universe contract

A future Universe read model should be assembled from explicit source records and normalized media references. Its conceptual output is:

```js
{
  entity: { type: "collection" | "person" | "movie" | "tv", id: "source-id", name: "..." },
  members: [{ media_type: "movie" | "tv", id: "source-id", content_id: "movie:123" }],
  relationships: [{
    from: { type: "movie" | "tv" | "person" | "collection", id: "source-id" },
    to: { type: "movie" | "tv" | "person" | "collection", id: "source-id" },
    relation: "member-of" | "same-person" | "similar-to" | "recommended",
    source: "tmdb-explicit" | "derived-order" | "recommendation",
    confidence: "explicit" | "derived" | "suggested"
  }],
  watchOrder: [{
    content_id: "movie:123",
    order: 1,
    basis: "source-order" | "release-date"
  }]
}
```

This is a **design shape, not a runtime module or persisted schema**. Implement only the fields supported by real data. A relationship's provenance must survive rendering so UI copy can distinguish confirmed membership from suggestions.

Watch-order rules:

- Prefer an explicit order provided by a trusted source.
- Otherwise, release-date ordering may be offered only when dates are known and should be labelled as release order.
- Do not invent chronological/universe order.
- Mixed movie/TV lists must keep typed IDs throughout.
- A missing TV relationship must not be guessed from a movie collection.

Universe should link into existing title routes and detail surfaces. Do not create a second title page, media normalizer, or recommendation ranker.

### 5. Vivid Night contract

A future Night planner receives user intent and optional group constraints, then reuses current candidate generation and ranking. Its conceptual input/output is:

```js
{
  intent: {
    mediaType: "movie" | "tv" | "all",
    genreIds: { movie: 28, tv: 10759 },
    runtimeMax: 120,
    language: "en",
    year: 2024
  },
  constraints: {
    totalMinutes: 180,
    peopleCount: 2,
    allowSeries: true
  },
  picks: [{
    content_id: "movie:123",
    reason: "Matches the stated genre and runtime",
    runtimeMinutes: 110,
    runtimeSource: "tmdb",
    fit: "verified" | "partial"
  }]
}
```

This is a **conceptual contract only**. It is not a new storage schema, UI, or claim that every constraint is supported.

Rules:

- Reuse the deterministic `parseIntent()` and existing recommendation APIs; do not add a mandatory LLM or paid endpoint.
- Only claim a runtime match when runtime metadata exists. A movie runtime cap and a TV episode runtime cap are different constraints; total-night duration for a series requires known episode runtimes and must not be inferred from one episode.
- Distinguish verified metadata filters from soft preferences. Unsupported mood, content-warning, dub/subtitle, provider availability, or group-consensus claims must be surfaced as unsupported instead of silently applied.
- Do not treat the current Tonight dismissal/session state as a durable planner or group-session store.
- Group votes, saved plans, or cross-device collaboration require a separate privacy/ownership design before persistence. Do not add a Firestore collection or change security rules as part of this preparation phase.
- Explanations must state why a pick fits and which constraints were actually applied.

### 6. Navigation and ownership

- Keep Universe and Night out of the primary navigation until each has a complete, useful end-to-end experience.
- Do not add placeholder HTML routes, dead links, empty nav items, speculative service-worker assets, or unused shared modules in Phase 4.
- When implemented, both modules must respect the existing guest/account owner boundary and must not expose one account's Memory to another.
- Do not claim cross-device behavior-history sync; Phase 3 explicitly leaves behavior events device-local.

## Implementation sequence for future work

1. **Universe:** verify TMDB's source fields and required endpoints, then implement one complete relationship path with provenance, typed links, empty/error states, and tests.
2. **Night:** define the smallest complete plan experience; establish runtime metadata availability, distinguish hard constraints from preferences, and test explainability before adding persistence.
3. Reuse the existing title detail, Library, Memory, and recommendation components. Only add an extension point when the first real consumer requires it.
4. Run the full automated suite and syntax check, then perform manual desktop/mobile and account-isolation QA before release claims.

## Phase 4 acceptance checklist

- [x] The two future modules have explicit, bounded contracts.
- [x] Canonical typed media identity and existing shared APIs are documented.
- [x] Relationship provenance and unsupported-constraint handling are explicit.
- [x] No new route, primary-nav item, persisted store, Firestore rule, or backend dependency is introduced.
- [x] Contract tests protect typed identity and canonical title navigation.
- [ ] Full repository test/syntax checks run successfully in CI.
- [ ] Manual browser/device QA remains a separate release gate.

## Explicit non-goals

This phase does not implement a franchise graph, a group planner, social voting, cross-device group sessions, new Firestore collections, new paid services, or new user-facing navigation. It prepares the architecture so those features can be built later without duplicating Memory or Intelligence.
