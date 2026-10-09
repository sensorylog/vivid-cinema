# Vivid Newsroom & Community — Operations and Launch Gate

## Current implementation slice

This branch adds the first News/community foundation without replacing the existing TMDB-based release and discovery feed:

- Public-to-read community posts, topic filters, topic follows, likes, threaded post replies, block controls and reporting.
- Source-first story detail pages with comments and comment reporting.
- A Newsroom section that reads only published Firestore articles and links to each original source.
- A moderator-only source registry, editorial publishing form, report queue, content hiding and account suspension status.
- Firestore composite indexes and explicit rules for member participation, article publication, source approval and moderation.
- Service-worker shell entries for the new pages/assets.

The editorial feed is intentionally empty until a trusted moderator approves sources and publishes verified articles. No synthetic or placeholder headlines are generated. This is manual curation; automated RSS/API ingestion has not been added in this slice.

## Trusted moderator claim

The UI does not grant moderator privileges. Moderator pages and writes require the Firebase Authentication custom claim `moderator: true`, set through a trusted Admin SDK environment with restricted credentials. Never set custom claims from browser code or from a user-editable Firestore profile.

Before production, an authorized project operator must:
1. Confirm the intended Firebase project and environment.
2. Assign the moderator claim only to named, trusted operator UIDs using a trusted Admin SDK environment.
3. Refresh/re-authenticate the moderator session and verify the moderation page remains inaccessible to ordinary accounts.
4. Keep the Admin SDK service account and credentials out of the repository and browser.

No claim was assigned and no Firebase service was deployed by this branch.

## Publisher approval workflow

1. A moderator researches the publisher and records the domain, ownership/track record, corrections practices, regional relevance, source reliability and licensing/image terms.
2. The moderator approves the publisher in the source registry.
3. The editorial desk accepts only articles whose source domain is present in the approved registry and whose publisher name matches that registry entry.
4. The moderator checks the original page, headline and publication date; writes a concise original summary; adds the source link; and only uses an image if rights/terms permit it.
5. The article is published with source metadata and a stable Firestore ID. Corrections should be recorded and the story's updated timestamp changed only when the Vivid story actually changes.

The editorial desk is the manual fallback and review path. A scheduled server-side RSS/Atom ingestion function is included in this branch: it reads only approved source records with an explicitly approved feed URL, rejects non-HTTPS/cross-domain redirects and ambiguous or stale/future-dated items, deduplicates canonical source URLs, limits excerpts, and only uses feed images when the source record says image usage was reviewed. The function has not been deployed or run against real feeds. Before enabling it, validate each feed URL and usage terms, confirm Firebase billing/Cloud Scheduler availability, deploy indexes/rules/functions to staging, and observe a complete ingestion cycle.

## Security behavior

- Public reads are limited to published stories/posts/comments.
- Post/comment/reaction/follow/report writes require Firebase Authentication and a verified email claim.
- The author's UID and display name are checked against the authenticated identity/profile.
- User-generated text lengths and topic values are bounded by Firestore rules.
- Server timestamps are required for creation/moderation records.
- Reactions are keyed by user UID; a user cannot update an existing reaction to forge another identity or create duplicate likes for the same post.
- User blocks are private to the blocking user's account.
- Moderator permissions rely on a trusted custom claim; user-editable profile data cannot grant moderator rights.
- A suspended community user cannot create new posts, comments or reactions through these rules.
- Public profiles and private email/account fields are not exposed by the new community collections.

Client-side checks improve usability but are not security controls. Firestore rules remain the authority.

## Required pre-launch tests

These have **not** been run by this branch; use the Firebase Emulator Suite and deployed staging project.

### Access and identity
- Signed-out user can read published stories/posts/comments but cannot create a post, comment, reaction, follow, block or report.
- Signed-in but unverified account cannot participate.
- Verified member can create only content with their own UID and exact profile display name.
- Attempts to spoof another author, add unexpected fields, exceed text limits, use invalid topics or supply client-chosen creation timestamps are rejected.
- User A cannot read User B's blocked-user list or private report records.
- Ordinary accounts cannot read the full moderation queue, publish articles, approve sources, hide content or suspend users.

### Content lifecycle
- Only approved publisher domains with matching publisher identity can be used for new article publication.
- Disabled/unapproved sources cannot be used for new article writes.
- Future-dated articles are rejected.
- Hidden posts/comments disappear from public reads and remain available to authorized moderators.
- A suspended user cannot create posts, comments or reactions.
- Owner deletion and moderator removal work as expected.

### Reliability and UX
- Feed/article/comment queries have deployed composite indexes.
- Mobile and desktop layouts, keyboard focus, screen readers, reduced motion and long text are checked.
- Offline/network errors show usable messages.
- Service-worker v114 activates and caches the new shell pages.
- Existing TMDB release filters, recommendations, reminders, account sign-in and library behavior are regression-tested.
- Moderator source approval and article publication are verified end-to-end on staging.

## Known gaps before calling this launch-ready

- Scheduled RSS/Atom ingestion code exists but is not deployed or verified against real publisher feeds; manual editorial publishing remains available.
- No poll/vote feature yet; safe vote aggregation needs a trusted server-side path rather than a client-editable counter.
- No user-to-user follow or notification fan-out yet; topic follows are implemented.
- Rate limiting and anti-spam beyond authentication/rules are not complete. App Check and trusted server-side abuse controls should be evaluated before broad public launch.
- No Firebase Emulator rules test suite is wired into CI yet.
- The live Firebase project, indexes/rules/functions deployment, billing/scheduler availability and custom moderator claims have not been verified or deployed.
- Browser/device QA has not been run from this environment.

Do not describe the system as production-ready until these gates are closed.
