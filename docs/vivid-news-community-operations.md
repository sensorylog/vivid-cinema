# Vivid Cinema Newsroom & Community — Operations and Launch Gates

## Scope of this branch

This draft adds a sourced newsroom with an editor-selected lead story, a live community-highlights strip, story discussions, a separate community feed, polls, member/topic follows, post editing/deletion, reports, blocks and a moderator-only report queue while preserving the existing TMDB discovery experience.

The product direction is a hybrid of editorial selection, latest stories, trending signals and community conversation. Coverage should include global entertainment plus Ghanaian, Nollywood and wider African cinema. The UI is intentionally a Vivid editorial/culture room, not a visual copy of another social platform.

## News source and ingestion policy

- \`functions/news-sources.js\` is a research shortlist, not a live allowlist. Every candidate starts with \`approvedForUse: false\` and \`ingestionEnabled: false\`.
- The scheduled GitHub Actions workflow reads the moderator-managed Firestore \`newsSources\` registry and processes only records with \`status: approved\`, \`feedApproved: true\`, and \`ingestionEnabled: true\`.
- Feed permission, automated ingestion permission, and image-use permission are separate approvals. Confirm the publisher's current terms, attribution requirements, regional relevance and source reliability before enabling any feed.
- The workflow does not use Cloud Functions, deploy Firebase services, scrape article pages, or download story images. It stores only a bounded headline, source URL, date, byline and short feed excerpt.
- Every discovered item is written to the private \`newsQueue\` collection as \`pending_review\`. It never writes directly to the public \`articles\` collection.
- The feed client requires HTTPS, caps responses at 2 MB, limits redirects to three, rejects redirects outside the approved publisher host, deduplicates canonical URLs and ignores stories older than 14 days or dated more than five minutes in the future.
- A moderator must open the original report, verify the source and date, write a fresh Vivid summary, choose category/region, and add a review note before publication. Feed excerpts are shown for reference only; images are never copied by the pipeline.
- Pulse Ghana and any other source without an explicitly permitted feed/API remain manual candidates. Do not scrape their websites.
- No source is enabled by default. Automated discovery remains idle until an owner configures GitHub Actions credentials and a moderator explicitly approves a feed and enables ingestion.

## Moderator identity

The moderator UI does not grant privilege. Access is based on the trusted Firebase Authentication custom claim `moderator: true`. Set claims only from a trusted Admin SDK environment with restricted credentials. Never assign moderator claims from browser code or user-editable profile data.

No moderator claim was assigned and no Firebase service was deployed by these feature branches.

## Firestore rules, indexes and hosting

- `firestore.rules` is the authorization boundary; client-side checks are only for usability.
- `firestore.indexes.json` declares composite indexes for newsroom, community, comments, reports and polls.
- `firebase.json` wires Firestore rules and indexes and retains the repository's existing functions codebase configuration; this newsroom pipeline does not deploy or invoke Cloud Functions.
- Deploy the Firestore rules to a staging project and run the emulator tests before production rollout. Do not deploy functions as part of this work.
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

CI runs static validation and Firestore Emulator security tests for every PR commit. Recent completed runs passed both jobs; check the PR's Checks tab for the latest commit-specific result. Browser/device QA, mobile accessibility checks, staging deployment, live ingestion verification and production rollout remain outstanding.

**Do not merge or deploy until the owner explicitly approves after review.**
