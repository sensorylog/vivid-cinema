# Vivid Newsroom Engine

## How it works

1. Moderators approve publishers in the source registry and record the current feed-use terms.
2. Automated discovery is a separate opt-in. It is disabled by default.
3. GitHub Actions runs the feed discovery workflow every six hours and on manual dispatch.
4. The ingestion script reads only Firestore sources marked approved, feed-approved and ingestion-enabled.
5. RSS/Atom metadata is deduplicated into the private \`newsQueue\` collection as \`pending_review\`; the workflow never publishes stories directly.
6. A moderator checks the original report and date, writes a fresh Vivid summary, chooses a region/category and records a verification note.
7. Publishing creates the public article and records the queue decision in one Firestore batch.

## Setup

The workflow intentionally does nothing until the repository owner configures its Firebase Admin authentication in GitHub Actions. Use a dedicated, least-privilege service account, store credentials only in GitHub Actions secrets, restrict repository access and rotate credentials if exposed. Never put credentials in the repository or workflow logs. Keyless GitHub OIDC / Workload Identity Federation is preferred for production.

After authentication is configured, run **Actions → Vivid News discovery → Run workflow**. No source is fetched until a moderator has explicitly approved its feed terms and enabled ingestion. This workflow uses GitHub Actions and the Firebase Admin SDK; it does not deploy or invoke Cloud Functions.

## Source and copyright controls

- Entries in \`functions/news-sources.js\` are candidates, not legal approvals. Every entry starts disabled.
- Review current source terms, attribution, reliability, feed permissions and image rights before enabling a source.
- Feed requests require HTTPS, are limited to 2 MB, time out, allow at most three same-publisher redirects and reject off-domain links.
- The pipeline stores a headline, byline, date, canonical source link and a bounded feed excerpt. It does not ingest full articles or images.
- Stories older than 14 days or more than five minutes in the future are skipped.
- Queue reads and decisions are moderator-only. Firestore rules require a corresponding public article to be created in the same batch before a candidate can be marked published.
- The feed excerpt is for review only. Moderators must write an original summary and add a verification note before publication.
- Sources without an explicitly permitted feed/API remain manual-only; do not scrape their sites.

## Validation

\`\`\`sh
npm install --no-audit --no-fund
node --test tests/newsroom-ingest.test.mjs
npm run check:syntax
npm run test:rules
\`\`\`

The scheduled pipeline is not live-verified until the owner configures authentication and at least one source is reviewed and enabled.
