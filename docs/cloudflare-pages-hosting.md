# Cloudflare Pages primary hosting and Firebase Hosting backup

## Hosting roles

- **Cloudflare Pages** is the primary static frontend host for Vivid Cinema.
- **Firebase Hosting** is retained as a manual backup. Its GitHub Actions deployment remains manual-only; run it only when intentionally switching or validating the backup and after checking Firebase Hosting quota.
- Firebase Authentication, Firestore, Firebase AI Logic, and App Check remain on the existing Firebase project. Moving static hosting does not migrate or disable these services.
- Netlify is retired from the intended hosting setup. This repository change does not delete the Netlify project or disable its deployment; those are separate dashboard actions.
- Cloudflare Pages Functions and Workers are not required for this static hosting plan. Movie media is not stored in Pages; the app continues to use its configured external services.

## Cloudflare Pages build settings

- Repository: `sensorylog/vivid-cinema`
- Production branch: `main`
- Framework preset: None / static HTML
- Build command: `npm run build:web`
- Build output directory: `dist`
- Root directory: `/`
- Environment variables: none are required by the current static build script

The shared script `automation/build-static-dist.mjs` creates `dist/`, excludes repository/backend source, and includes the root `_headers` file for Cloudflare Pages. Do not publish the repository root.

## Headers and caching

The root `_headers` file defines the Cloudflare Pages security policy and asset caching behavior. Firebase Hosting has its own response-header configuration in `firebase.json`; keep both aligned when the security policy changes. Cloudflare's headers do not configure Firebase services or external video providers.

## Validation checklist

Before making Cloudflare the only public host, verify the deployed Pages site:

1. Main page and important routes: Home, Discover, For You, Live, Library, title details, and watch page.
2. Firebase initialization, email/password sign-in, Google sign-in if enabled, password reset, and email verification.
3. Firestore-backed profile and library behavior.
4. Firebase AI Logic / Vivid Recall and App Check.
5. TMDB requests, images, external playback embeds, Paystack checkout if used, service worker/PWA behavior, and mobile Safari/Chrome.
6. In Firebase Authentication, ensure the Pages hostname (and any custom hostname) is listed in Authorized domains where required.
7. In the Google Cloud reCAPTCHA Enterprise configuration used by Firebase App Check, allow the Pages hostname for the existing site key. Do not disable App Check as a workaround.

## Firebase Hosting backup

The Firebase Hosting deployment workflow is manual-only. When intentionally testing or switching to the backup, open GitHub Actions, choose **Deploy Vivid Cinema to Firebase Hosting**, and run it on `main` after checking quota and credentials. Confirm the deployed Firebase URL before relying on it as the fallback.

## Rollback and boundaries

If Cloudflare has an outage or a regression, Firebase Hosting remains the intended backup. This repository change does not delete the Firebase project, Firebase Auth, Firestore, App Check, or the existing Firebase Hosting configuration. Static hosting bandwidth limits and Firebase service quotas are separate; Cloudflare Pages does not remove quotas imposed by Firebase or other APIs.
