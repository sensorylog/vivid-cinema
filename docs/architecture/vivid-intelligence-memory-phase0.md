# Vivid Intelligence + Memory — Phase 0 Architecture & UX Blueprint

**Status:** Phase 0 specification; no runtime behavior changed  
**Scope:** Establish the UX, data ownership, architecture, privacy rules, and acceptance criteria for Phases 1–4.  
**Constraints:** Static-first web app; reuse the existing TMDB/Firebase client architecture; no Firebase Cloud Functions, no Blaze-only backend requirement, no duplicate library or playback-progress stores.

## 1. Product goal

Vivid should help a person answer two questions better than a generic streaming catalogue:

1. **What should I watch next, given my mood, time, and taste?** — Vivid Intelligence.
2. **Can Vivid remember my viewing journey and preferences reliably?** — Vivid Memory.

The product's differentiator is the loop between them: Memory records user-controlled library state and meaningful signals; Intelligence uses those signals to produce explainable recommendations; explicit feedback improves future results. A recommendation is a suggestion, never a claim that Vivid hosts or guarantees playback availability.

## 2. Repository audit: current baseline

The repository already has meaningful pieces of this foundation:

- `scripts/intelligence.js`: local feedback, behavior events, taste-profile construction, cold-start selection, and Firestore sync helpers.
- `scripts/recommendations.js`: playback progress, completion state, Continue Watching, candidate ranking, For You recommendations, “Because you liked…”, and a Tonight pick.
- `scripts/library.js`: the existing typed, local-first Favorites / Watch Later / History library and owner-scoped Firestore synchronization.
- `scripts/tmdb.js`, `scripts/media.js`, and `scripts/content.js`: existing metadata, normalized media, discovery, and catalogue requests.
- `scripts/watch.js`: playback progress and behavior-event instrumentation.
- `scripts/library-page.js`: existing library UI and Continue Watching shelf.
- `scripts/routes.js` and `scripts/config.js`: centralized route names and route parsing.
- `firestore.rules`: owner-scoped rules already exist for `progress`, `feedback`, `events`, and `taste`, in addition to the library collections.
- Existing app surfaces include `home.html`, `discover.html`, `title.html`, `watch.html`, `library.html`, and `account.html`.

**Main gap:** the recommendation and intelligence modules exist, but there is no dedicated `for-you.html` route or first-class For You destination in the current route map and primary navigation. The user-facing journey, explicit intent filters, clear progress semantics, and module-level tests need to be specified and then completed. This phase does not presume the current helpers are production-ready just because they exist.

## 3. Information architecture

### First-class destinations

- **Home** — editorial/trending discovery and existing hero experience.
- **Discover** — broad catalogue search and filters. Keep Movies, TV, and anime discovery accessible here.
- **For You** — new personalized destination; the main entry point for Intelligence and a compact view of Memory.
- **My Library** — canonical place for Favorites, Watch Later, History, and the Continue Watching shelf.
- **News** — existing release/editorial surface.
- **Account** — identity, account settings, and preferences.

### Navigation proposal

- Desktop: add **For You** beside Discover and Library; preserve News and account access.
- Mobile: keep navigation compact. Prefer Home, Discover, For You, Library, and Search in the primary bottom bar; keep News and Account reachable through existing secondary/header routes. Do not add a separate tab for each future feature.
- Add `for-you.html` as the canonical page and register it in `scripts/config.js` and `scripts/routes.js`. Use the existing app shell, visual tokens, poster/card conventions, loading/empty/error states, and responsive patterns.
- Do not rename or replace the existing Library route. Memory is a cross-app capability, not a second library page.

### For You page hierarchy

1. **Personalized greeting / taste status** — short, non-invasive, no fabricated certainty.
2. **“What are you in the mood for?”** — natural-language input plus editable chips for inferred constraints.
3. **Quick intent controls** — movie / series / anime where metadata supports it; runtime; genres; release period; language; rating floor; and “surprise me.”
4. **Top picks for you** — ranked titles with concise, truthful reasons.
5. **Continue Watching** — sourced from the canonical playback-progress store.
6. **Because you liked…** — only when a meaningful liked seed exists.
7. **Explore something new** — controlled diversity so the page does not repeat only the user's dominant genre.
8. **Feedback controls** — “More like this” / “Not for me,” with an undo or clear path.

Do not display empty shelves. Use skeletons during loading, actionable retry on request failure, and a useful cold-start state when the user has little or no history.

## 4. Ownership boundaries

Keep one authoritative owner for each type of data.

| Data | Canonical owner | Phase 0 decision |
|---|---|---|
| Favorites, Watch Later, History | `scripts/library.js` and its current local/Firestore model | Extend existing entries only when needed; do not create a parallel watchlist. |
| Playback resume point and completion | `scripts/recommendations.js` progress model | Reuse it for Continue Watching and title/episode resume actions. |
| Explicit title feedback | `scripts/intelligence.js` feedback model | Reuse the existing `like` / `not_for_me` concepts and their typed media key. |
| Derived taste profile | `scripts/intelligence.js` | Treat as rebuildable derived data, not the sole source of truth. |
| Recommendation ranking and explanations | `scripts/recommendations.js` | Extend/test the existing ranking pipeline instead of implementing a second engine in the page. |
| Catalogue metadata | Existing TMDB client | Use supported metadata; unknown properties must not be inferred as facts. |
| Identity and remote access | Existing Firebase Auth / Firestore rules | Keep every personal document under `users/{uid}`; no new privileged backend. |
| For You UI state | New page module | Keep transient filters/input in page state; persist only intentional user preferences. |

Use the existing typed identity convention (`movie:<id>` / `tv:<id>`) wherever a title-level key is needed. Episode-level progress must retain the existing progress-key convention; do not collapse separate episodes into one title progress record.

## 5. Intelligence MVP behavior

### Intent interpretation

Phase 2 should begin with a deterministic, explainable client-side parser—not a required paid LLM. Translate common phrases into structured constraints, then show the inferred constraints as editable chips before or alongside results.

Examples:

- “A dark anime under 25 minutes an episode” → TV/anime preference where metadata supports it, darker genre/theme signals where available, episode-runtime cap if the API supplies it.
- “A funny movie for tonight, less than two hours” → movie, comedy signal, runtime <= 120 minutes.
- “Something like this but less violent” → use supported similar/recommendation metadata and user-controlled genre/tone exclusions only where reliable metadata exists.

If a phrase cannot be grounded in available metadata, ask a small follow-up or explain the limitation rather than silently inventing a filter. TMDB does not reliably encode every trope, dub/sub availability, content warning, or mood; do not promise exact results for unsupported attributes.

### Ranking

Use the existing taste-profile and candidate-ranking helpers as the baseline. Ranking can combine:

- Explicit likes and “not for me” exclusions.
- Favorites, Watch Later, and History signals.
- Playback progress/completion signals where valid.
- Genre, original language, release decade, country, and cast/creator metadata.
- Quality/popularity/freshness as tie-breakers, not the whole recommendation.
- A diversity term to avoid repetitive rails.
- Impression/click memory to reduce repeated recommendations, without treating an impression as a dislike.

### Explanations and feedback

Each displayed explanation must be traceable to a real signal (“Because you liked X”, “Matches your interest in science fiction”, “A different genre to explore”). Avoid false precision such as unsupported percentages or “AI understands you perfectly.” Feedback must update the canonical feedback store, invalidate stale recommendation caches, and render an observable success/error state.

### Cold start

Offer an optional, dismissible preference picker using real catalogue titles. A user may select a few favorites to seed the profile, skip it, or browse normally. Do not block the app behind onboarding and do not require an account to try basic discovery.

## 6. Memory model and viewing semantics

Memory should make the current library and progress more useful without fragmenting them.

### User-visible states

- **Planned** — represented by the existing Watch Later list.
- **Watching / Continue** — derived from non-completed playback progress.
- **Completed** — based on explicit completion/progress rules, with a clear manual correction path.
- **Paused / Dropped** — later enhancement only if it can be represented without conflicting with current library semantics; do not introduce competing status stores in Phase 1.

For TV, distinguish title-level series progress from season/episode resume data. Display season and episode only when known. A failed or unsupported playback source must not falsely advance progress. Preserve a manual way to mark a title or episode watched if reliable automatic completion is unavailable.

### Data minimization

- Persist only compact identifiers, progress, timestamps, and metadata needed to render the user's library.
- Keep analytics events bounded and avoid sensitive free-text query storage by default.
- Do not send a full viewing history to an external AI service in this plan.
- Provide a path to clear feedback/history/preferences and explain the effect of clearing derived taste data.
- Guest data remains local; authenticated data remains owner-scoped. Account switching must not expose another user's state or silently destroy unsynced state.

## 7. Existing risks to resolve before shipping

These are audit findings for the implementation phases, not claims that live production sync has been tested.

1. **Account-switch handling differs across stores.** The library module preserves per-account local snapshots, while intelligence and playback-progress owner helpers currently remove their single local keys on owner change. Phase 1 must define a consistent preserve/restore policy and test guest-to-account, account-to-account, sign-out, and second-device flows.
2. **Intelligence writes are fire-and-forget.** The `cloud()` helper does not expose completion/failure to its caller. Feedback and profile persistence need an explicit retry/error contract; the UI must not imply remote sync is confirmed when it is not.
3. **Auth listeners may be one-shot.** The current intelligence/progress sync helpers resolve after the first auth-state callback and unsubscribe. Confirm lifecycle behavior across sign-in/sign-out/account changes and re-entry; do not assume the first callback is a permanent listener.
4. **Behavior events are write-only in Firestore rules.** This can be an intentional privacy choice, but event-derived personalization will be device-local unless a deliberately safe merge/aggregation design is introduced. Phase 1 must not promise cross-device event history without resolving this.
5. **Progress and library history are separate stores.** This is valid if documented, but the UI must define which data drives resume state, watched state, and history. Avoid silently treating “opened title” as “watched title.”
6. **Test coverage gap.** The current `package.json` test command does not list dedicated Intelligence, recommendation-ranking, or playback-progress-sync tests. Add focused tests before the new UI depends on those behaviors.
7. **Runtime QA is not implied by source inspection.** A passing static/unit suite cannot prove cross-device Firestore sync, actual TMDB responses, iOS navigation, or real playback progress. Those require explicit browser/device checks.

## 8. Four-phase delivery plan

### Phase 1 — Memory foundation

- Define and document the current library/progress/feedback schema and migration compatibility.
- Normalize local owner switching across library, progress, and intelligence without data leakage or avoidable loss.
- Make progress semantics consistent for movies and TV episodes.
- Make cloud sync outcomes observable, retryable, and testable while retaining local-first UI behavior.
- Add unit tests for identity keys, completion/resume thresholds, account switching, merge/conflict handling, and failure recovery.
- No new page UI beyond small correctness improvements needed to make Memory trustworthy.

**Exit criteria:** Existing Favorites / Watch Later / History still work; local progress survives refresh; guest data remains usable; remote failures do not masquerade as confirmed sync; switching accounts never reveals another account's local state; tests cover the identified edge cases.

### Phase 2 — Intelligence MVP

- Add `for-you.html`, page styles/module, route registration, and navigation.
- Compose the existing recommendation helpers into real UI with cold-start, loading, empty, error, retry, and feedback states.
- Add deterministic intent parsing and editable filter chips.
- Explain each recommendation with grounded reasons; do not require a paid AI endpoint or Cloud Functions.
- Add ranking/parser/UI-structure tests.

**Exit criteria:** The page works for guests and signed-in users; intent constraints visibly affect results; feedback affects later results; unsupported intents are handled honestly; no duplicate library/progress source is created.

### Phase 3 — Integration and reliability

- Wire meaningful title opens, trailers, playback, completion, library changes, and feedback into the recommendation loop without duplicate event spam.
- Verify cache invalidation, progress updates, cold start, account sync, and account switching end to end.
- Run regression tests for Home, Discover, title detail, watch, Library, Account, PWA/offline shell, and Firestore rules.
- Perform browser/device tests and a real two-device test against the configured Firebase project before claiming cross-device reliability.

**Exit criteria:** A user's real actions affect recommendations predictably; no regression in existing routes; sync and privacy claims are backed by recorded tests.

### Phase 4 — Prepare future modules

- Document shared interfaces for **Vivid Universe** (franchise/relationship graph and watch orders) and **Vivid Night** (time/mood/group session planner).
- Let both reuse typed title identity, metadata, Memory signals, and recommendation explanations.
- Keep them out of the main navigation until each has a useful complete experience.
- Add extension points only when a real implementation needs them; avoid speculative abstractions and nonfunctional placeholders.

**Exit criteria:** The next features can reuse the same canonical stores and components without duplicating memory, identity, ranking, or navigation logic.

## 9. Test plan and acceptance matrix

| Area | Required tests |
|---|---|
| Typed identity | Movie and TV IDs with the same numeric ID never collide; episode progress keys remain distinct. |
| Ranking | Likes boost relevant candidates; “not for me” is excluded; candidates deduplicate; genre/type diversity is enforced; cold start works with no profile. |
| Intent parsing | Supported runtime/type/genre/year/language constraints map correctly; unknown constraints are surfaced instead of silently applied. |
| Memory | Save/resume/complete/reopen behavior; threshold boundaries; manual correction; progress vs. history consistency. |
| Persistence | Offline/local save, remote write failure, reconnect retry, newer timestamp wins, deleted-item tombstones, bounded event storage. |
| Accounts | Guest → first sign-in, sign-out, user A → user B, user B → user A, same user on a second device, no cross-user leakage. |
| UI | Loading, no recommendations, no history, malformed query, API error/retry, keyboard access, reduced motion, mobile navigation. |
| Regression | Existing Home, Discover, Title, Watch, Library, Account, authentication, PWA, and Firestore rules. |

## 10. Explicit non-goals

- No replacement streaming backend, media hosting, proxy, or download feature.
- No dependency on Epidemic Sound or the Music-Streaming-API repository for Intelligence/Memory.
- No Firebase Cloud Functions, paid AI service, new server, or Blaze-only dependency.
- No wholesale redesign of existing Home/Discover/Library.
- No claims that recommendations are “AI-powered” beyond what is actually implemented and tested.
- No future Universe/Night feature implementation during Phases 1–3.

## Phase 0 completion checklist

- [x] Audited current routes, shared data modules, Firestore paths/rules, and test command.
- [x] Identified existing intelligence/recommendation helpers to reuse.
- [x] Defined the navigation and For You page hierarchy.
- [x] Defined data ownership, privacy boundaries, risks, and migration requirements.
- [x] Defined phases and measurable exit criteria.
- [ ] Phase 1 implementation and runtime validation (future work).
