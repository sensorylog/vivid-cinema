# Cloudflare Pages primary hosting and Firebase Hosting backup

## Hosting roles

- **Cloudflare Pages** is the primary static frontend host for Vivid Cinema.
- The Watch Rooms API runs as a Cloudflare Pages Function at `/api/watch-rooms` on the same origin as the site. The existing `api/` directory is excluded from the static Pages artifact. The separate email-verification endpoint still has its own historical serverless route and is not changed by the Watch Rooms migration.
- **Firebase Hosting** is retained as a manual backup. Its GitHub Actions deployment remains manual-only; run it only when intentionally switching or validating the backup and after checking Firebase Hosting quota.
- Firebase Authentication, Firestore, Firebase AI Logic, and App Check remain on the existing Firebase project. Moving static hosting does not migrate or disable these services.
- Netlify is retired from the intended hosting setup. This repository change does not delete the Netlify project or disable its deployment; those are separate dashboard actions.
- Cloudflare Pages Functions are used only for the Watch Rooms API; movie media is not stored in Pages, and the app continues to use its configured external services.

## Cloudflare Pages build settings

- Repository: `sensorylog/vivid-cinema`
- Production branch: `main`
- Framework preset: None / static HTML
- Build command: `npm run build:web`
- Build output directory: `dist`
- Root directory: `/`
- Build-time dependencies: the build installs the isolated Cloudflare function dependencies under `cloudflare/` before bundling the Pages Function.
- Runtime secrets: `FIREBASE_SERVICE_ACCOUNT_JSON` and `PAYSTACK_SECRET_KEY` must both be configured as encrypted secrets in Pages Settings → Variables and Secrets for **Production** (and Preview if preview checkouts are tested). The Paystack key must be the matching live key for production; never put it in `wrangler.toml`, source code, or frontend variables. The hosted Paystack Payment Page URLs do not need a browser API key, but Vivid requires the server-side secret to verify Paystack webhook events/transactions before granting Premium access.

The shared script `automation/build-static-dist.mjs` creates the static `dist/` assets and excludes repository/backend source. The `build:web` command then bundles `cloudflare/functions/` into the `dist/_worker.js/` directory (`index.js` entrypoint); the root Firebase Functions directory is not used as the Pages Functions source. Do not publish the repository root.

## Pages Functions runtime

The root `wrangler.toml` enables `nodejs_compat` for the Pages Functions bundle and sets the Pages output directory to `dist`. Keep the Cloudflare Pages Production and Preview compatibility settings aligned with this config. The Watch Rooms and Anime Premium Functions require Node.js compatibility for their Firebase dependencies. Keep `FIREBASE_SERVICE_ACCOUNT_JSON` and `PAYSTACK_SECRET_KEY` encrypted as secrets, not plain-text public variables.

## Headers and caching

The root `_headers` file defines the Cloudflare Pages security policy and asset caching behavior. Firebase Hosting has its own response-header configuration in `firebase.json`; keep both aligned when the security policy changes. Cloudflare's headers do not configure Firebase services or external video providers.

## Validation checklist

Before making Cloudflare the only public host, verify the deployed Pages site:

1. Main page and important routes: Home, Discover, For You, Live, Library, title details, and watch page.
2. Firebase initialization, email/password sign-in, Google sign-in if enabled, password reset, and email verification.
3. Firestore-backed profile and library behavior.
4. Firebase AI Logic / Vivid Recall and App Check.
5. TMDB requests, images, external playback embeds, Anime Premium country directory (`/api/anime-premium/countries` returns the bundled full ISO list), local-currency quote (`/api/anime-premium/exchange-rate?currency=NGN`), hosted Paystack checkout, webhook verification, service worker/PWA behavior, and mobile Safari/Chrome.
8. Confirm the Pages Production secrets `FIREBASE_SERVICE_ACCOUNT_JSON` and `PAYSTACK_SECRET_KEY` exist. A missing Paystack secret intentionally disables checkout; do not bypass that guard because successful payment must be verified before membership activation.
6. In Firebase Authentication, ensure the Pages hostname (and any custom hostname) is listed in Authorized domains where required.
7. In the Google Cloud reCAPTCHA Enterprise configuration used by Firebase App Check, allow the Pages hostname for the existing site key. Do not disable App Check as a workaround.

## Firebase Hosting backup

The Firebase Hosting deployment workflow is manual-only. When intentionally testing or switching to the backup, open GitHub Actions, choose **Deploy Vivid Cinema to Firebase Hosting**, and run it on `main` after checking quota and credentials. Confirm the deployed Firebase URL before relying on it as the fallback.

## Rollback and boundaries

If Cloudflare has an outage or a regression, Firebase Hosting remains the intended backup. This repository change does not delete the Firebase project, Firebase Auth, Firestore, App Check, or the existing Firebase Hosting configuration. Static hosting bandwidth limits and Firebase service quotas are separate; Cloudflare Pages does not remove quotas imposed by Firebase or other APIs.
