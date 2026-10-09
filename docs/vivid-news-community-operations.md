# Vivid Cinema Newsroom & Community — Operations and Launch Gates

## Scope of this branch

This draft adds a sourced newsroom with an editor-selected lead story, a live community-highlights strip, story discussions, a separate community feed, polls, member/topic follows, post editing/deletion, reports, blocks and a moderator-only report queue while preserving the existing TMDB discovery experience.

The product direction is a hybrid of editorial selection, latest stories, trending signals and community conversation. Coverage should include global entertainment plus Ghanaian, Nollywood and wider African cinema. The UI is intentionally a Vivid editorial/culture room, not a visual copy of another social platform.

## News source and ingestion policy

- `functions/news-sources.js` is a code-side research shortlist only; the scheduled job does not ingest from that shortlist.
- The scheduled job reads the moderator-managed Firestore `newsSources` registry and selects only records with `status: approved` and `feedApproved: true`.
- All candidate feeds must remain `approvedForUse: false` until source reliability, feed terms, attribution/display permissions and any image rights have been reviewed.
- Pulse Ghana is a manual editorial candidate only; do not scrape its website. Confirm an official permitted feed/API before any automation.
- `VIVID_NEWS_INGESTION_ENABLED` must remain unset or anything other than `true` until an authorized owner explicitly approves the source set.
- The ingestion job stores bounded metadata/excerpts and links to the original report. It does not republish full articles or feed images.
- Each feed request is HTTPS-only, capped at 2 MB, limited to three redirects, and checked against the approved publisher domain at every redirect hop.
- The scheduled Firebase Function has not been deployed or verified against live feeds. Check billing, quotas, scheduler availability and source-specific terms before staging.
- The moderator page now includes a publisher registry and manual editorial desk. Source approval and manual publication are enforced by Firestore rules, not just by hidden UI panels.
- Manual story source URLs must match the approved publisher domain; image reuse requires explicit source approval and the image URL must be hosted on that publisher's domain (root or `www`).

## Moderator identity

The moderator UI does not grant privilege. Access is based on the trusted Firebase Authentication custom claim `moderator: true`. Set claims only from a trusted Admin SDK environment with restricted credentials. Never assign moderator claims from browser code or user-editable profile data.

No moderator claim was assigned and no Firebase service was deployed by these feature branches.

## Firestore rules, indexes and hosting

- `firestore.rules` is the authorization boundary; client-side checks are only for usability.
- `firestore.indexes.json` declares composite indexes for newsroom, community, comments, reports and polls.
- `firebase.json` wires the rules, indexes and scheduled-function codebase. It also excludes server code, docs, tests and the index definition from the public Hosting directory.
- Deploy rules/indexes/functions to a staging Firebase project first. Review the generated deployment plan and project ID before any deployment.
- Community participation is intended for registered, email-verified accounts. Recheck every write path against the rules, including edit/delete, poll votes, reports, blocks, follows and moderator actions.

## Required pre-launch validation

### Authorization and privacy
- Signed-out users can read only published public content and cannot participate.
- Unverified accounts cannot post, comment, react, vote, follow, block or report.
- Members cannot spoof author identity, edit another member's content, vote twice, or change a vote after submission.
- Private report records and blocked-user lists cannot be read by ordinary users or other members.
- Ordinary accounts cannot publish articles, change content status, or access moderator-only report data.
- Hidden content is no longer publicly readable, and report resolution/hide actions work for reported newsroom stories, community posts, polls, and supported comments. Account-level reports still require a dedicated moderator action.

### Content and source integrity
- Unapproved feeds remain disabled; ingestion is off by default.
- Feed URLs and redirect destinations are validated to prevent off-domain fetches.
- Canonical source URLs are deduplicated; invalid, stale and future-dated items are rejected.
- Headline, publisher, date, source URL and excerpt are accurate; the original source is clearly linked.
- No image is reused unless the source's image rights permit it.
- Corrections and editorial selection have an auditable, trusted workflow before public launch.

### Product and reliability
- Browser/device QA covers narrow iPhones, Android-sized layouts, desktop, keyboard navigation, focus states and screen readers.
- Authentication return-to behavior, service-worker upgrades, offline states and navigation are tested.
- Existing TMDB release/discovery, search, recommendations, reminders, account and library flows pass regression tests.
- Emulator security tests run in CI; staging tests validate rules/indexes and end-to-end workflows.
- Rate limiting, abuse controls, App Check, report escalation and moderator operations are reviewed before broad public launch.

## Current status

Static syntax, JSON, imports, app-shell assets and local-reference checks pass on the current draft iterations. Firestore Emulator tests have passed on the latest security-rule revision, including publisher-domain/image-rights enforcement and moderator story takedown; the newest community editing/highlights iteration is receiving its final CI run. Browser/device QA, staging deployment, live ingestion verification and production rollout have not been completed.

**Do not merge or deploy until the owner explicitly approves after review.**
