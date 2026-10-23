# Cloudflare Pages static hosting

## Purpose

Cloudflare Pages is being prepared as an additional static frontend host for Vivid Cinema. This does not replace or modify the Firebase backend, Netlify deployment, or Firebase Hosting deployment workflow.

- Firebase Authentication, Firestore, Firebase AI Logic, and App Check remain on the existing Firebase project.
- Netlify remains available.
- Firebase Hosting remains available and its existing manual deployment workflow is unchanged.
- Cloudflare Pages Functions and Workers are not required for this hosting plan.
- The site must continue to use external movie/provider URLs; movie media is not stored in Pages.

## Cloudflare Pages build settings

Connect repository `sensorylog/vivid-cinema` to Cloudflare Pages with:

- Production branch: `main` after the configuration change is merged
- Framework preset: None / static HTML
- Build command: `npm run build:web`
- Build output directory: `dist`
- Root directory: `/`
- Environment variables: none are required by the current static build script

The existing `automation/build-netlify-dist.mjs` creates `dist/` and copies the root `_headers` file into it. Do not configure Pages to publish the repository root; publishing `dist/` keeps repository metadata and backend source out of the deployment.

## Headers and caching

The root `_headers` file ports the existing security policy and asset cache behavior from `netlify.toml` to Cloudflare Pages syntax. Keep the two configurations aligned if the security policy changes later.

Cloudflare Pages applies `_headers` to static responses. These rules do not configure Firebase services and do not affect responses served by external video providers.

## Safe migration checklist

1. Merge the Cloudflare static-host configuration into `main`.
2. In Cloudflare Dashboard, create a Pages project and connect the GitHub repository.
3. Use the build settings listed above and deploy to the generated `*.pages.dev` preview hostname.
4. Test the deployed site before changing any custom-domain DNS.
5. Test Firebase initialization from `init.json`, email/password and Google sign-in if enabled, password reset, email verification, Firestore-backed profile/library behavior, Firebase AI Logic / Vivid Recall, App Check, TMDB requests, images, external playback embeds, Paystack checkout if used, service worker/PWA behavior, and all important page routes.
6. In Firebase Authentication, add the final Pages hostname (and custom hostname if used) to Authorized domains where needed.
7. In the Google Cloud reCAPTCHA Enterprise configuration used by Firebase App Check, allow the Pages hostname for the existing site key. Do not disable App Check to make a deployment work.
8. Only after tests pass, optionally connect a custom domain to Cloudflare Pages. Leave Netlify and Firebase Hosting in place as rollback options.

## Rollback

No existing host is deleted or disabled by this configuration. If Cloudflare tests fail, keep using the current Netlify site and retry after fixing the preview deployment. Firebase Hosting remains untouched and can be deployed using the existing manual GitHub Actions workflow when its quota is available.
