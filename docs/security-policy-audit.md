# Security policy audit — Cloudflare Pages

## Changes made

- Removed the unused `us-central1-vivid-cinema.cloudfunctions.net` and `vivid-cinema-api.vercel.app` origins from `connect-src`. Core client modules for Firebase AI, Firebase Auth, Firestore, and TMDB do not reference these endpoints.
- Added a regression test that prevents either retired backend origin from being reintroduced accidentally.
- Kept the existing `object-src 'none'`, `base-uri 'none'`, and script policy without `unsafe-eval`.

## Deliberately not narrowed in this change

- `img-src https:` and `media-src https:` are broad. Vivid loads user/provider artwork and streams from changing third-party origins, so narrowing them blindly can break posters, avatars, or playback. Collect browser CSP violations and inventory actual production origins before restricting these directives.
- `frame-src` includes many playback providers. Remove an origin only after confirming it is no longer selected by the player or used by an embedded sign-in/payment flow.
- Some HTML documents contain inline scripts while the current `script-src` does not include `unsafe-inline`. Do not weaken the policy to make them run; migrate inline scripts into same-origin files or add stable hashes for exact inline content, then verify the app under real browsers.

## Required verification after deployment

1. Open Home, Discover, Library, Account, payment, authentication, and playback routes.
2. Inspect Safari/WebKit and Chromium console CSP violations.
3. Confirm Firebase sign-in/Firestore, TMDB poster loads, checkout, and all intended playback embeds still work.
4. Only then consider restricting the broad image/media directives.
