# Cloudflare Turnstile → Firebase App Check

Vivid's web app uses Cloudflare Turnstile as its browser-attestation signal and exchanges the verified proof for a **real Firebase App Check token**. Firebase Authentication, Cloud Firestore, the synced library, and Watch Rooms continue using Firebase App Check. This replaces only the attestation provider; it does not disable App Check enforcement or change account identity.

## Cloudflare Turnstile widget

Create a Turnstile widget in the Cloudflare dashboard:

- Widget mode: **Managed**
- Hostnames:
  - `vivid-cinema.pages.dev`
  - `vivid-cinema.web.app`
  - `vivid-cinema.firebaseapp.com`
- Add any additional production hostname that Vivid actually serves from.
- Keep preview deployments disabled unless their hostnames are explicitly added to the widget.

Copy the widget's site key and secret key.

## Cloudflare Pages environment

Add these variables to the **Production** environment of the `vivid-cinema` Pages project:

| Variable | Type | Value |
|---|---|---|
| `TURNSTILE_SITE_KEY` | Plain text | The widget's public site key |
| `TURNSTILE_SECRET_KEY` | Secret | The widget's private secret key |

The existing `FIREBASE_SERVICE_ACCOUNT_JSON` and `FIREBASE_PROJECT_ID=vivid-cinema` settings are reused. Do not expose the service-account JSON or Turnstile secret in frontend files, GitHub commits, or browser logs.

The Firebase web app ID is pinned server-side to the production app in `init.json`. If the web app is ever recreated, update that constant in `cloudflare/functions/api/app-check.js` and its tests together.

## How the exchange works

1. Firebase's supported `CustomProvider` asks the client provider for an App Check token.
2. The browser runs a Managed Turnstile challenge with action `vivid_app_check`.
3. The client sends the one-use Turnstile token to same-origin `/api/app-check`.
4. The Pages Function validates the token with Cloudflare Siteverify, including exact hostname and action checks.
5. The Pages Function signs the short-lived Firebase App Check custom token with the existing service-account key and exchanges it through Firebase's `exchangeCustomToken` API.
6. Firebase returns a normal signed App Check token. The Firebase SDK caches it and renews it when needed.

Turnstile proofs are single-use and expire after five minutes. They are never reused for multiple requests. The exchanged Firebase App Check token has a one-hour lifetime. No Firebase Cloud Function or Firebase Extension is introduced.

## Release safety checklist

- [ ] Create the Turnstile widget and add the two Pages environment variables.
- [ ] Confirm the existing Firebase service-account secret is present in Production.
- [ ] Deploy the Pages Function and confirm `GET /api/app-check` returns `ok: true` and a site key (never a secret).
- [ ] Confirm the first App Check exchange succeeds and returns a Firebase-issued token.
- [ ] Keep Firebase App Check enforcement enabled for the services currently enforced.
- [ ] Verify email/password signup, email verification, email/password sign-in, and Google sign-in.
- [ ] Verify profile creation/update and library cloud sync (favorites, Watch Later, history, tombstones).
- [ ] Verify Watch Rooms create/dashboard/invite/join/chat/playback.
- [ ] Confirm Turnstile and App Check errors fail closed; do not add a bypass or silently disable App Check.

Localhost remains intentionally excluded from production App Check attestation, matching the existing development behavior. Production HTTPS origins must be present in the Turnstile widget's hostname list.
