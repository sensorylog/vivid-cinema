# Vivid Cinema News Upgrade — Product Plan and Repository Audit

**Status:** Planning only. No News feature implementation has been started.  
**Audit date:** 2026-10-09  
**Repository:** `sensorylog/vivid-cinema`  
**Planning branch:** `planning/vivid-cinema-news-upgrade-audit`  
**Audit baseline:** `main` at `6243e331e6ece7229b37c67f6ef420e8dad13f8d`

## 1. Locked product decisions

These decisions are approved as the working product direction. They are requirements for the plan, not permission to begin implementation.

1. **Feed model:** Hybrid editorial + latest + trending + community.
2. **News sources:** Curated core sources plus additional sources only after validation.
3. **Community:** Both discussions attached to news articles and a dedicated community feed.
4. **Moderation:** Reporting, blocking and moderator tools must be available before public launch.
5. **Coverage:** Global entertainment with intentional Ghanaian, Nollywood and wider African entertainment coverage.
6. **Participation access:** Only registered, signed-in users may like, comment, reply, post, vote, follow topics/users or otherwise participate. Public visitors may read published news and browse public discussions. Enforce participation restrictions in Firestore/backend rules, not only in the UI.

## 2. Repository audit

### Existing News page and data source

Relevant files:

- `news.html`: existing News page structure and navigation.
- `scripts/news.js`: feed assembly, filtering, recommendation, trailer discovery, search and refresh.
- `scripts/tmdb.js`: shared TMDB client and request cache.
- `styles/vivid-news.css`: News page styling and responsive layout.
- `scripts/firebase.js`, `scripts/auth.js`, `scripts/nav-auth.js`: Firebase setup and account UI.
- `firestore.rules`: database access controls.
- `firebase.json`: Firebase Hosting configuration and Firestore rules path.
- `.github/workflows/ci.yml`: static repository checks.

**Finding:** The current News page is a cinematic release/discovery feed, not a conventional entertainment-news article feed. `scripts/news.js` obtains catalogue data from TMDB: daily trending titles, movie/TV release-date ranges, popular titles, recommendations and trailer metadata. Headlines are generated from title names and templates; descriptions are based on TMDB catalogue overviews. The search checks movies and TV titles, not news articles.

The current UI already has valuable pieces to preserve: cinematic hero, responsive card styling, filters for today/this week/coming/TV/trending/for-you, release calendar, catalogue search, recommendation fallback, trailer discovery, reminders, refresh controls and progressive rendering when optional requests fail.

### Current data-quality limitations

The current feed does not provide a news publisher/byline, original article URL, publication timestamp, article update timestamp, source attribution, article-level correction history, or news-source validation. “Trending” reflects TMDB catalogue trending, not community engagement or a verified cross-publisher entertainment-news trend. A title's release/first-air date is not the same thing as a news article's publication date, and a series first-air date should not automatically be presented as an individual episode event.

The shared TMDB client caches responses in memory and session storage for about five minutes. That cache is useful for catalogue browsing but does not establish the freshness or accuracy of an actual news article. Current feed freshness depends on upstream TMDB data and network availability.

The current News page intentionally searches the Vivid movie/TV catalogue; this should remain distinct from a future news search so the existing title-search behavior is not silently broken.

### Current authentication and backend

Vivid already uses Firebase Authentication and Firestore. Email/password account creation sends an email verification message, and the existing email/password login flow refuses an unverified account. Google sign-in is also present. The app uses the Firebase client SDK and loads its runtime config from Firebase Hosting's reserved init endpoint with a local fallback.

Current Firestore rules scope profile, library, taste, feedback, events, push subscriptions and reminders to each user's `users/{uid}` space. The rules end with a deny-all catch-all for any unrecognized collection/path. This is a sound default-deny starting point, but there are **no existing public article, community post, comment, reaction, vote, follow, report or moderation data paths** in the rules.

The tracked repository contains no visible server-side News ingestion function, scheduled news feed job, community page/module, dedicated article detail route, package manifest or test files. Existing automation scripts are for cinema reminders and release alerts, not news ingestion. The absence of these files does not rule out separately configured Firebase services, so deployed project configuration and permissions must be checked before selecting a final backend design.

### CI and verification

The current GitHub Actions workflow runs static checks including JavaScript syntax, JSON validity, local JS imports, app-shell/service-worker assets, internal navigation targets and local HTML/CSS/JS references. The tracked tree has no dedicated automated test files for Firestore rules or News behavior. The repository README also identifies browser/device and deployed Firebase-rule checks as pending in several areas.

Before release, the plan therefore requires explicit Firestore Rules tests (preferably the Firebase Emulator Suite), UI/browser checks on mobile and desktop, and verification against the deployed Firebase project. A passing static CI workflow alone is not proof that authentication, data rules, News ingestion or moderation works in production.

### Repository status note

At audit time, GitHub reports PR #117, “Maintenance: make service-worker caching safer,” as merged into `main` on 2026-10-09, changing only `service-worker.js`. This differs from the earlier recorded state that it was unmerged. This audit did not perform that merge. News work must remain isolated from that maintenance change.

## 3. Refined product definition

Vivid Cinema News should become a connected entertainment-news and discussion experience with four related surfaces:

- **News home:** editorial lead, latest stories, trending stories, regional coverage, followed topics and community highlights.
- **Article detail:** publisher/source attribution, original link, author when available, publication and update times, short attributed summary, related coverage, correction/update notices and a discussion thread.
- **Community:** a dedicated public-to-read feed for text posts, linked articles/title discussions, topic spaces and polls.
- **Account/activity:** public display profile, followed topics, saved stories, notifications, replies/mentions and the user's own posts.

The current catalogue feed and title search should not be discarded. Keep title discovery distinct from actual reporting, and reuse existing shell/design patterns where they fit. Avoid building direct messages, private groups, live chat or image uploads in the initial release; they expand moderation and abuse risk before core community safety is proven.

### Hybrid feed rules

- **Editorial:** human-curated or explicitly approved lead stories.
- **Latest:** ordered by trustworthy publication time, with a clear updated timestamp when changed.
- **Trending:** based on a documented mix of freshness, meaningful engagement and editorial relevance; do not fabricate engagement counts or reward outrage alone.
- **Community:** active discussions linked to stories and topics, ranked with anti-spam and freshness safeguards.
- **Personalized:** optional topic follows and reading/community activity; provide understandable controls and a usable general feed when signed out.

## 4. News sourcing and accuracy architecture

Use a curated, explicit source registry first. Additional feeds/providers must be assessed for credibility, relevance, stable metadata, access terms, licensing, image rights, reliability, rate limits, cost and geographic coverage before inclusion. Do not scrape or republish full articles without permission. Link to original reporting and use appropriately brief, attributed summaries.

The current static client should not be the trusted source-ingestion layer. Recommended target shape:

1. A trusted scheduled ingestion process obtains approved feeds/APIs.
2. A normalizer validates source identity, canonical URL, headline, dates, author/publisher, image rights/URL, category and region tags.
3. Duplicate detection groups multiple reports about the same development while preserving each source link; new developments must not be collapsed into stale articles.
4. Editorial/review rules label unconfirmed reports and opinion clearly, preserve uncertainty, and keep the publisher's wording separate from any Vivid-written summary.
5. Normalized public articles are persisted in Firestore or another explicitly chosen store, with source and freshness metadata.
6. Failed feeds, stale articles, invalid dates, duplicate spikes and broken source links are observable and recoverable.

A Firebase scheduled function/Cloud Function plus Firestore may fit the current Firebase architecture, but it is not present in the tracked code today. Confirm deployed Firebase plan, billing constraints, secrets/config handling, scheduler availability, quotas and operational ownership before committing to it. Do not expose provider secrets in browser code. If a trusted server-side ingestion path is not feasible, revise the source scope rather than shipping a misleading “live news” feed.

Each article should have a stable internal ID and, at minimum, source/publisher, canonical source URL, headline, author when available, publishedAt, updatedAt, ingestedAt, summary, image rights/source, category, region/topic tags, verification/status metadata and correction history where applicable. Display publication time separately from ingestion/update time. Validate dates and URLs; never invent missing authors, publication dates, source links or factual certainty.

### Regional coverage

Create explicit source and category coverage for Ghanaian cinema, Nollywood and wider African entertainment, alongside global film, television, streaming, celebrity, trailers and awards. Regional coverage should come from a reviewed source registry and topic taxonomy—not merely a region label attached to generic global stories. Track source coverage gaps and broken feeds.

## 5. Community, identity and security

### Access behavior

- Signed-out visitors: read public articles, open source links and browse public discussions.
- Signed-in registered users: participate through likes/reactions, comments, threaded replies, posts, polls/votes, follows and saves.
- Authentication prompts should preserve the article/discussion and action the visitor was attempting, then return them there after sign-in.
- Apply the existing email-verification policy consistently. Confirm the exact verified-account requirement for Google and other providers before implementation; client-only gating is not sufficient.

### Logical data areas

Design and test the schema before coding. Expected logical entities include:

- `articles` and `articleGroups` for normalized reporting and developing/duplicate stories.
- `users` or a public-profile projection that contains only safe public fields; never expose email/private account data through public profile reads.
- `posts`, `comments` and parent IDs for threaded replies.
- `reactions` with one reaction per user/content target.
- `polls` and `votes` with one valid vote per user/poll, unless a poll explicitly defines a different rule.
- `follows`, `savedArticles` and `notifications`.
- `reports` and append-only or tightly controlled `moderationActions` for review/audit trails.

Keep article-feed reads and comment pagination separate so a large discussion does not delay the News home. Use stable IDs and server-enforced constraints to prevent duplicate likes/votes, spoofed authors, cross-user edits, forged moderator privileges and malformed content.

### Required security controls

- Firestore rules/backend authorization for every create/update/delete; UI hiding alone is not authorization.
- Authors can edit/delete only their own eligible content; moderator powers are granted only by trusted configuration/custom claims, never by user-editable profile fields.
- Validate allowed fields, lengths, types, parent references, timestamps and content status.
- Prevent repeated reactions/votes with stable user-scoped IDs or a trusted transaction path.
- Add rate/abuse controls, spam detection and App Check where supported; App Check complements rather than replaces auth/rules.
- Keep public profile fields separate from email, credentials and private account preferences.
- Plan for user deletion, content deletion/anonymization policy, account suspension and notification privacy.

Firestore Security Rules alone are not a full moderation queue or general-purpose rate limiter. The final design may require trusted server-side functions for atomic counters, moderation actions, notification fan-out and abuse controls.

## 6. Moderation launch gate

The following must exist before public launch, not as a vague post-launch promise:

- Report article/post/comment/user with a reason and timestamp.
- Block/mute a user and hide their content from the reporting user's experience.
- Moderator queue with report context, status and action history.
- Authorized actions to remove/hide content, lock discussions, resolve reports and suspend/ban accounts.
- Community guidelines, spoiler handling, anti-spam limits and a clear appeal/contact path.
- Audit trail for moderator actions and least-privilege moderator roles.
- Defined response ownership and escalation process.

Do not launch community posting if reporting/blocking/moderator workflows are only visual mockups or can be bypassed through direct Firestore requests.

## 7. Delivery phases and exit criteria

### Phase 0 — Repository and deployment audit (current)

Map current files, APIs, auth, Firestore rules, caching, navigation and CI. Confirm deployed Firebase project/services and available source-provider options before selecting infrastructure.

**Exit:** architecture map, source/licensing assessment, security gap list and test plan reviewed; no News implementation changes.

### Phase 1 — Final specification and architecture

Choose source registry/provider mix, trusted ingestion runtime, article schema, public-read/write rules, regional taxonomy, moderation roles and migration strategy. Preserve existing title search/release/reminder behavior. Record decisions and acceptance tests in the plan before coding.

**Exit:** implementation tasks are scoped by file/service; costs, secrets, permissions and deployment responsibilities are known.

### Phase 2 — News data and article experience

Implement source ingestion/normalization, attribution, stable IDs, deduplication, publication/update timestamps, freshness/error states, regional categories, article detail and original-source links.

**Exit:** every article is traceable to a real source; no fabricated headline/source/date; failures degrade gracefully; duplicates and stale items are handled.

### Phase 3 — Community core

Add public discussion reads, account-gated posts, article comments, threaded replies, reactions, polls/votes, follows and public-safe profiles, with backend enforcement.

**Exit:** signed-out write attempts fail at the backend; spoofed authors and cross-user mutations fail; duplicate reactions/votes are prevented; content persists across sessions and reloads.

### Phase 4 — Safety and activity

Add report/block, moderator queue/actions, account suspension, notifications, saves, topic preferences, spoiler controls and abuse protections.

**Exit:** moderation workflows are exercised end-to-end with audit history; private user data is not exposed; abuse controls work server-side.

### Phase 5 — QA and controlled release

Test desktop/mobile layouts, keyboard/accessibility/reduced motion, network and provider failures, malformed data, expired sessions, account deletion, rule bypass attempts, duplicate reports, service-worker updates and regression of existing catalogue flows.

**Exit:** static CI passes, Firestore rules tests pass, browser/device smoke tests pass, deployment behavior is verified, and the reviewed PR has explicit owner approval. No merge or production rollout without the user's approval.

## 8. Success and release metrics

Track article source-link validity, source freshness, timestamp correctness, duplicate/developing-story handling, regional source coverage and ingestion failures. For community, track meaningful replies and returning participants alongside reports, spam rates and moderator response times. For performance, track time to useful News content, mobile load/scroll behavior and failed requests. Never use fabricated engagement or raw likes alone as the ranking objective.

## 9. Immediate next steps

1. Validate the source/provider and server-side ingestion options against the actual deployed Firebase project, billing/quotas and legal/licensing constraints.
2. Draft the detailed source registry and article metadata policy, with explicit Ghanaian/Nollywood/African coverage.
3. Finalize Firestore collection/rule design and the moderation operating model.
4. Turn the phases above into a file-by-file implementation plan and test matrix.
5. Only then begin implementation, on a dedicated News branch with small, reviewable commits.

**No News feature code has been changed in this planning branch. This document records the product direction and audit findings only.**
