# Vivid Cinema — Staging deployment and test runbook

This runbook is for the **first staging test after PR #119**. Use a separate Firebase staging project, not the production project. The News ingestion function must remain disabled during the first deploy.

## 0. Confirm the target before deploying

From the repository root:

```bash
node --version
npm --version
firebase --version
firebase login
firebase projects:list
```

Use Node.js 22 for the Functions codebase. If you do not already have a dedicated staging Firebase project, create one in the Firebase console first. Do not use a production project just to get through the setup.

Set the project ID explicitly for every command below. Replace the placeholder; do not paste it literally:

```bash
export VIVID_STAGING_PROJECT_ID="YOUR_STAGING_FIREBASE_PROJECT_ID"
firebase use --add
```

When `firebase use --add` prompts you, select the staging project and give it a clear local alias such as `staging`. Confirm the alias points to the staging project:

```bash
firebase use
firebase projects:list
```

Before deploying, verify that the selected project ID is the staging ID and that it contains no production user data.

## 1. Install and validate locally

```bash
npm --prefix functions install
npm --prefix functions run check
npm install --prefix tests
npm --prefix tests run test:rules
```

The repository CI also checks JavaScript syntax, JSON, local imports, app-shell assets, navigation targets, and runs Firestore Rules tests. The commands above run the Functions syntax check and the same Firestore Rules test script used by CI. The full static checks are run by GitHub Actions; confirm a green run on the latest merged `main` commit before staging.

## 2. Deploy the UI and Firestore policy first (no Functions yet)

This first deployment intentionally excludes Cloud Functions:

```bash
firebase deploy --project "$VIVID_STAGING_PROJECT_ID" --only hosting,firestore:rules,firestore:indexes
```

Wait for the command to finish and save its output. Open the Hosting URL printed by Firebase. Test the existing home, discovery, title, search, account and library flows before concentrating on News and Community.

If this project has never had Firebase Authentication configured, enable the sign-in providers that Vivid already uses in the Firebase console. Test with a dedicated staging account and complete email verification.

## 3. Moderator-only editorial testing

Moderator access depends on the trusted Firebase Authentication custom claim `moderator: true`. The website does **not** grant this claim. Set it only for your own staging test account using a trusted Admin SDK environment with restricted access; never place service-account keys in the repository or browser code.

Before testing, confirm:
- A signed-out visitor can read only public published content and cannot participate.
- A signed-in, email-verified non-moderator can use allowed community actions but cannot access the moderator desk or publish a story.
- Your designated staging moderator can approve a source and publish a manual story only when the Firestore rules' source and URL requirements are met.
- Story reports are private to the reporter/moderator workflow, and hiding a reported story removes it from public reads.
- Editing/deleting a post works only for its owner; test with a second account to confirm cross-account changes are denied.
- The News page, story detail, comments, community feed, polls, reports and block controls behave correctly on a narrow mobile viewport and desktop.
- Existing TMDB discovery, title detail, account and library flows still work.

Use clearly labelled test content in staging. Do not copy real users' private data into the staging project.

## 4. Optional Functions deployment — requires Blaze

The scheduled RSS/Atom ingestion is a Cloud Function. **Firebase requires the Blaze pay-as-you-go plan to deploy Cloud Functions.** You can deploy Hosting and Firestore rules/indexes first without deploying the Functions codebase; do not enable billing just to test the UI.

Before opting into Blaze:
1. Confirm the Google Cloud Billing account and the staging project are correct.
2. Create a small monthly budget and email alerts.
3. If available in your console, configure a Cloud Functions for Firebase / Cloud Run functions spend cap as an extra safeguard. A spend cap is not an instantaneous hard ceiling; usage reporting and enforcement can lag.
4. Review the Firebase pricing documentation linked below. Scheduled functions use Cloud Scheduler; each scheduler job is priced at USD $0.10/month, with an allowance of three jobs per Google account at no charge. Other usage can still incur charges.
5. Keep ingestion off. Do not approve feeds until reuse/display terms, source reliability and image rights are reviewed.

After billing is enabled for **staging only**, deploy Functions with the opt-in left false:

Create a local, untracked file named `functions/.env.<YOUR_STAGING_FIREBASE_PROJECT_ID>` containing:

```dotenv
VIVID_NEWS_INGESTION_ENABLED=false
```

Replace the filename placeholder with the exact staging project ID. Do not commit this file. The function only ingests when the value is exactly `true`, so `false` keeps it disabled.

Then deploy only the Functions codebase:

```bash
firebase deploy --project "$VIVID_STAGING_PROJECT_ID" --only functions
```

If the deploy reports that Cloud Scheduler or another required API must be enabled, review the requested API and enable it for the staging project only. Confirm the scheduled function exists and logs the disabled message. **Do not set the flag to `true` during initial staging tests.** First verify the source registry, publisher permissions, deduplication and error handling with reviewed test sources and explicit owner approval.

## 5. Smoke-test and capture results

Record the following before considering launch readiness:

- [ ] Staging project ID and Hosting URL confirmed
- [ ] Latest `main` commit and CI run recorded
- [ ] Firestore rules and indexes deployed successfully
- [ ] Authentication and email verification tested
- [ ] Moderator custom claim verified on the intended staging account only
- [ ] Unauthorized writes and private report reads rejected
- [ ] Manual story publication, attribution, reporting and takedown tested
- [ ] Community post, reply, poll, edit/delete, block and report flows tested
- [ ] iPhone-sized viewport, Android-sized viewport and desktop checked
- [ ] Existing TMDB, account and library regression flows checked
- [ ] If Functions were deployed: ingestion flag confirmed false and logs checked
- [ ] Budget alerts configured; any available spend cap reviewed
- [ ] No production deployment or live feed ingestion performed

## Official Firebase billing references

- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Cloud Functions FAQ and billing requirements](https://firebase.google.com/docs/functions/faq-and-troubleshooting)
- [Scheduled Functions and Cloud Scheduler pricing](https://firebase.google.com/docs/functions/schedule-functions)
- [Firebase budget alerts](https://firebase.google.com/docs/projects/billing/budget-alerts)
- [Firebase spend caps](https://firebase.google.com/docs/projects/billing/spend-caps)

Budget alerts send notifications; they do not stop charges. Spend caps are available only for select services and can have enforcement delays. Treat these controls as safeguards, not a guarantee of zero overage.

## Scope boundary

This is a staging runbook, not permission to deploy to production. Keep ingestion disabled until sources and rights have been reviewed and approved. No production deploy, billing change, moderator-claim assignment, or feed opt-in is performed by this document.
