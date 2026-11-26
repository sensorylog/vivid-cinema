# VIVID ANIME PREMIUM — platform foundation

## Product boundary

VIVID ANIME PREMIUM is a new, independent anime destination inside Vivid Cinema. It will have its own route family, presentation layer, catalogue experience, title/detail experience, watch experience, subscription entitlements and administration surface.

The existing Movies & TV product remains unchanged. The legacy `anime.html` route is the clearly labelled Free Anime sampler: six curated series, one first-episode preview per series, and a direct upgrade path. The full catalogue, complete series/films, dedicated watch experience and personal anime library belong to VIVID ANIME PREMIUM.

## Identity and authentication

- Reuse the existing Firebase Authentication instance exported by `scripts/firebase.js`.
- Reuse the existing Vivid account/profile model. Do not create a second identity provider, login database or duplicate account profile.
- A user must have a non-anonymous Vivid account before starting subscription checkout.
- Subscription ownership is keyed to the authenticated Firebase UID, never an email address supplied by the browser.
- Preserve the existing Vivid auth flow, email verification rules, Google sign-in, persistence and return-to routing.
- For email/password sign-up, retain the Premium return destination through Vivid's existing verification email and the subsequent login. The verification endpoint accepts only the explicit `anime-premium.html` return destination; all other values fall back to the existing default verification route.
- A successful browser redirect or Paystack checkout callback must never itself grant Premium access.

## Route and module boundary

- Public Premium entry route: `anime-premium.html`.
- Premium-specific presentation assets use the `vivid-anime-premium` namespace.
- Premium client modules use the `anime-premium` namespace.
- The Premium app must not reuse the legacy anime page's catalogue/playback state as its access-control source.
- Later phases will add dedicated catalogue, title, watch, account and admin routes without changing Movies & TV routes.

## Entitlement trust boundary

Premium membership is backend-owned. The browser may display membership state, but it cannot create or modify a membership entitlement. The future subscription implementation must:

1. Require a Firebase ID token on protected Premium API requests.
2. Verify the token and resolve its UID on the server.
3. Read membership state from a server-controlled entitlement record.
4. Initialize and verify Paystack transactions on the server.
5. Verify webhook signatures against the unmodified request body.
6. Process webhook events idempotently.
7. Keep Paystack secret credentials out of client code.
8. Deny protected catalogue/playback access when entitlement is absent, expired, cancelled or unverified.
9. Link payment customer/subscription records to Firebase UID.
10. Keep voluntary Support Vivid donations separate from Anime Premium subscriptions.

The client must not trust query parameters, local storage, Firestore client writes, checkout redirect parameters or a client-supplied UID as proof of membership.

## Membership account journey

1. Visitor can view the public Premium introduction.
2. Selecting a subscription action requires a Vivid account.
3. Signed-out visitors use the existing Vivid sign-in/sign-up flow and return to the Premium journey. Email/password sign-up retains this destination across email verification and the subsequent login; Google sign-in returns directly.
4. Signed-in visitors continue with the same Firebase UID.
5. Backend-verified payment activates the entitlement for that UID.
6. Every protected API and playback-session request re-checks the server-owned entitlement.

## Six-phase delivery plan

1. Foundation and architecture — separate route/module boundary, shared Vivid authentication, entitlement trust model and safe deployment structure.
2. Premium UI and discovery — homepage, catalogue, search, filters and collections.
3. Anime identity and title experience — identity cards, title pages and title-specific Living Cinematic Backdrop.
4. Watch experience — dedicated watch route/player, episode navigation, language/subtitle controls, progress and recovery.
5. Membership, backend and administration — Paystack flows, entitlement service, webhook handling, catalogue/admin tools and authorised provider integration.
6. Personalisation, optimisation and QA — My Anime, watchlists, continue watching, recommendations, accessibility, performance, security and regression testing.

The six-phase foundation was merged through PR #529. The follow-up branch continues the final integration work: limiting the Free Anime route, separating its navigation and access boundary from Premium, and completing the multi-period Paystack subscription flow. The final integration audit must cover Premium, the limited free Anime experience, Movies & TV and the shared Vivid account system together.

## Phase 1 implementation notes

The initial Premium route is a public introduction and account-aware shell only. It does not expose the Premium catalogue, playback URLs, checkout or any client-controlled membership state. Those capabilities are added in their respective later phases and must remain server-authorized.


## Phase 2 implementation — Premium discovery

The Premium entry route now acts as a dedicated discovery homepage rather than a static teaser.

- Curated shelves surface popular anime, series, films and highest-rated titles.
- Search uses the existing TMDB metadata integration and keeps results within Japanese-language anime or animation-tagged titles.
- Catalogue filters cover all anime, series, films, release year and sort order; pagination loads additional catalogue pages.
- Selecting a card opens an accessible title-preview dialog with artwork, synopsis, release year and rating.
- Discovery uses TMDB metadata and artwork only. It does not expose stream URLs, playback files, third-party embeds, checkout or client-side membership state.
- TMDB attribution is shown in the Premium footer. Image usage remains subject to the applicable TMDB terms.
- The discovery module is namespaced, included in the offline app shell and included in scoped syntax checks.
- The existing `anime.html` route remains a separate Free Anime entry point and is limited to the curated sample policy in `scripts/anime-free-policy.js`.


## Phase 3 implementation — anime identity and title experience

- Each anime card in the Signature Worlds rail receives a deterministic title-specific SVG silhouette mask, layered poster artwork, a Vivid identity stamp and a title lockup. The whole card remains a stable anchor target.
- Mobile uses a simpler rounded poster fallback; dense shelves and catalogue grids keep conventional poster cards for scanning speed.
- Cards and the featured hero now open the dedicated anime-premium-title.html route with a validated numeric TMDB id and explicit movie/series type.
- The title route loads title metadata, cast, genres, recommendations and available official YouTube trailer links through the existing TMDB integration.
- The Living Cinematic Backdrop selects multiple images belonging to the same anime, preloads the next image before switching, crossfades two persistent layers over 1.8 seconds, and advances every 8.5 seconds. A subtle Ken Burns movement adds depth without interrupting the image transition.
- Backdrop motion respects reduced-motion preferences, overlapping transitions are prevented, and the hero artwork/content fades as the reader scrolls into the title details.
- Title discovery remains metadata-only: the page does not create a playback session or expose stream URLs. Playback and membership remain reserved for their later phases.
- The title route, stylesheet and runtime are added to the offline app shell and scoped syntax checks, with dedicated structural tests for the identity masks and backdrop lifecycle.


## Phase 4 implementation — multi-server anime watch experience

- Adds a dedicated anime-premium-watch.html route with a responsive iframe player shell, season selector, episode browser, previous/next navigation and sub/dub controls.
- Uses VIVID's existing third-party embed model rather than a custom raw-stream resolver.
- Registers 14 provider endpoints: VidPlus, VidLink, VidSrc, AniXo, AniLink, MegaPlay, MegaPlay Legacy, Megavid, MegaFlix, VidAPI, EmbedWave, VidFast, Embed API Stream and VidRift.
- Reuses the existing AniList/MAL ID resolver and TMDB season/episode metadata to build provider-specific URLs. Each provider is enabled only when its required catalogue ID is available.
- VidAPI and EmbedWave are retained as requested; VidSrc, VidFast and Embed API Stream are also drawn from VIVID's existing provider set. Embed API Stream advertises 11 internal providers. VidRift is an additional researched provider with its own multi-source player.
- Providers with validated readiness/error events can trigger automatic failover. Other providers offer a manual next-server action rather than treating iframe load as proof of playback.
- Progress is saved only when a provider reports a valid time/duration pair. Incoming messages must match the active iframe's exact origin and source window.
- The playback endpoint verifies the existing Firebase user and active Premium membership, then issues a short-lived, user-owned playback session. It never returns a raw HLS/MP4 stream URL.
- Provider routes, ID matching limitations and title-by-title QA requirements are documented in `docs/vivid-anime-premium-streaming-provider-research.md`.
- The watch route, stylesheet, provider registry and anime ID resolver are included in the offline app shell, syntax checks and dedicated tests.

## Phase 5 implementation — Paystack, memberships and administration

### Server-owned payment flow
- Adds separate Cloudflare Pages API routes for public pricing, authenticated checkout, membership status, automatic renewal cancellation, Paystack webhook processing, protected playback and administrator operations.
- Checkout requires a verified Firebase ID token and verified email. The browser sends only country and payment method; amount, currency, plan code, reference, renewal mode and user identity are derived or verified server-side.
- Card checkout uses a configured Paystack plan code for the selected monthly, biannual (every 6 months) or annual interval and renews automatically. Mobile money uses a one-time Paystack transaction for the selected period and requires manual renewal. Mobile money is only offered for the currently supported GH/KE routes; the server validates this again.
- The existing displayed Ghana monthly price is represented as a configurable default of 5330 minor units (GH₵53.30) via `ANIME_PREMIUM_GHS_MONTHLY_AMOUNT`. Monthly, biannual and annual amounts and recurring Paystack plan codes are configured per currency and interval in `ANIME_PREMIUM_PLANS_JSON`. Six-month and annual prices are not invented in code; they must be approved and configured by Vivid before those options can be enabled.
- Country selection is populated from country/currency data; local-currency conversion is labelled as an estimate. Paystack's own checkout page displays the final billing currency and amount.
- Payment return never grants access. The signed Paystack webhook verifies its signature, verifies the transaction with Paystack, checks the stored checkout amount/currency/reference, and idempotently updates the membership document.
- Manual mobile-money renewals extend the existing entitlement period. Card subscription events maintain automatic-renewal state. Users can cancel card auto-renewal while retaining access through the paid period.

### Entitlement and playback security
- Firebase ID tokens are verified server-side; unverified email accounts cannot start checkout or use membership/playback APIs.
- Membership, checkout, webhook-event, source-registry and audit collections are explicitly denied to browser clients in Firestore rules.
- Playback checks the server-owned membership period before creating an expiring session for the fixed third-party embed registry.
- Provider URLs are generated from validated catalogue identifiers in the browser; no raw stream URL is returned by the membership endpoint or accepted from user-controlled state.

### Administration
- Adds a restricted admin workspace and server endpoints for audited membership grant/revoke.
- Admin access is checked from Firebase admin claims or the server-side ANIME_PREMIUM_ADMIN_UIDS allowlist. Each manual membership change creates an audit record.

### Required Cloudflare environment configuration before live payments
- FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID (existing Vivid server-side Firebase credentials).
- PAYSTACK_SECRET_KEY and PAYSTACK_WEBHOOK_SECRET (server secrets; never expose them to the browser).
- PAYSTACK_LIVE_ENABLED=true only in the production environment after the Paystack merchant, plan codes and webhook are configured. Checkout stays disabled in previews by default.
- `PAYSTACK_PLAN_GHS_MONTHLY` remains supported for legacy monthly setup. Use `ANIME_PREMIUM_PLANS_JSON` for each currency and billing period; card auto-renew is unavailable for a period/currency without its matching Paystack plan code.
- ANIME_PREMIUM_DEFAULT_CURRENCY (defaults to GHS) and optional ANIME_PREMIUM_GHS_MONTHLY_AMOUNT (defaults to 5330 minor units).
- ANIME_PREMIUM_ADMIN_UIDS for server-side admin allowlisting when custom admin claims are not used.
 - Configure the Paystack webhook URL as /api/anime-premium/webhook on the Vivid production origin. Support Vivid donations remain on their existing, separate payment flow.


## Third-party anime embed playback

VIVID ANIME PREMIUM uses the same iframe-provider model as the existing VIVID Cinema player. The Cloudflare playback endpoint verifies membership and issues a two-hour playback session; the browser then builds URLs from the static provider registry in `scripts/playback/anime-premium-providers.js`. Provider-specific postMessage events are accepted only from the active iframe's exact origin and window. See `docs/vivid-anime-premium-streaming-provider-research.md` for the provider list, route contracts, ID mapping and QA gates.

A provider's iframe route and published features do not guarantee that every title is indexed or that the provider is available in every territory. VIVID should measure actual title-level playback during QA and keep manual server switching available when a provider does not expose reliable readiness/error events.

## Free Anime and Premium boundary

- Free Anime is a sampler, not a second full catalogue: six curated TV series and only Season 1, Episode 1 of each.
- The free page labels each sample and links directly to the Premium destination. The generic watch route blocks other anime titles and episodes from the Free Anime entry point and does not mount episode navigation for the sample.
- VIVID ANIME PREMIUM remains the full catalogue, film/series discovery, dedicated title/watch pages, protected playback, membership and personal anime library.
- The client-side free preview gate is a product UX boundary, not DRM; third-party embeds cannot provide strong server-side content enforcement when users can open those providers outside Vivid.

## Multi-period Paystack configuration

`ANIME_PREMIUM_PLANS_JSON` uses period-first configuration. Example values below are placeholders and must be replaced with the approved Vivid prices and actual Paystack plan codes:

```json
{
  "monthly": {
    "GHS": { "amountMinor": 5330, "planCode": "PLN_MONTHLY_GHS" }
  },
  "biannually": {
    "GHS": { "amountMinor": 0, "planCode": "PLN_SIX_MONTHS_GHS" }
  },
  "annually": {
    "GHS": { "amountMinor": 0, "planCode": "PLN_ANNUAL_GHS" }
  }
}
```

Use the Paystack Dashboard to create plans with intervals `monthly`, `biannually` and `annually`; the plan code configured for a currency/period must have the same amount and interval as the server configuration. Mobile money does not use a recurring plan code and remains a one-time manual renewal for the chosen period. The server stores the selected period with the checkout and grants the matching entitlement duration only after the signed webhook and Paystack transaction verification succeed.

The Paystack hosted Payment Page URL supplied during implementation is not currently used by the Vivid in-app checkout. Vivid creates a server-owned transaction tied to the signed-in Firebase UID and relies on the webhook to activate access. Do not replace this with a static public payment URL unless the payment flow is redesigned to securely associate and verify each payment against the Vivid account.
