# Netlify-primary hosting and Firebase fallback

## Hosting roles

- **Netlify** is the default web host and should deploy automatically from the connected GitHub branch.
- **Firebase Hosting** is retained as a manual fallback. Its deployment workflow is deliberately manual-only so pushes do not repeatedly fail or consume the exhausted monthly Hosting quota.
- Firebase Authentication, Firestore, and Firebase AI Logic remain Firebase services. Moving static hosting does not migrate or disable those services.

The static Netlify build publishes `dist/` using `automation/build-netlify-dist.mjs`. The checked-in `init.json` is copied with the site so Firebase configuration can load from the same origin without relying on Firebase Hosting's reserved `/__/firebase/init.json` endpoint.

## When Firebase Hosting quota resets

1. Open GitHub Actions in this repository.
2. Select **Deploy Vivid Cinema to Firebase Hosting**.
3. Choose **Run workflow** on the `main` branch.
4. Confirm the workflow succeeds and check the Firebase Hosting URL.
5. Keep Netlify as the automatic primary host unless you intentionally decide to switch the public URL.

Do not re-enable push-triggered Firebase deployment unless the monthly quota and desired hosting strategy have been reviewed. Firebase Hosting and Netlify may serve the same commit, but each host has its own deployment and quota behavior.

## Required one-time setup for Vivid Recall on Netlify

Firebase App Check is domain-sensitive. A site working on Firebase Hosting does not prove App Check will accept the Netlify origin.

In the Firebase console for project `vivid-cinema`:

1. Open **App Check** and select the registered web app used by Vivid Cinema.
2. Confirm the web app is protected by the intended reCAPTCHA Enterprise provider and the site key matches the public key configured in `scripts/firebase.js`.
3. Add `vivid-cinema.netlify.app` to the allowed domains for the corresponding reCAPTCHA Enterprise site key in the Google Cloud reCAPTCHA Enterprise console.
4. Ensure the domain is allowed for the Firebase App Check web provider as applicable, then save the changes.
5. Confirm Firebase AI Logic is enabled for this project and the Gemini Developer API provider/model is configured.
6. Open `https://vivid-cinema.netlify.app/`, sign in if required by project policy, and test Vivid Recall. Check the browser console and Network panel if it fails.

The source code can improve diagnostics, but it cannot add an allowed domain to the Firebase or Google Cloud console. If App Check rejects the Netlify origin, Gemini calls can fail even while the rest of the website works.

## Diagnosis guide

- **App Check initialization / invalid site key / domain error:** check the Netlify hostname in the reCAPTCHA Enterprise allowed-domain list, App Check provider setup, and browser console.
- **401 / unauthenticated:** check whether AI Logic is configured to require a signed-in user and test while signed in.
- **403 / permission denied:** inspect Firebase AI Logic and App Check configuration; do not disable App Check as a workaround.
- **404 / model not found:** verify the model ID against the current Firebase AI Logic supported-model list.
- **429 / resource exhausted:** check provider quota and rate limits. Hosting quota is separate from Gemini model quota.
- **CSP blocked request:** inspect the browser console and keep the exact required Firebase/Google endpoint in the Netlify Content Security Policy; do not broadly allow arbitrary origins.

## Desktop and Android packaging

This repository's current `main` tree contains the web app and PWA, but no checked-in Electron wrapper or Android native project/build workflow. Therefore this hosting change does not automatically rewrite a previously built EXE or APK. For any wrapper that opens the hosted website, its configured URL must be updated to `https://vivid-cinema.netlify.app/` and a new package built. If a wrapper bundles the web files locally, verify that it also uses the current Firebase configuration and App Check-allowed origin for AI calls.
