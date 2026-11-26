# VIVID ANIME PREMIUM — platform foundation

## Product boundary

VIVID ANIME PREMIUM is a new, independent anime destination inside Vivid Cinema. It will have its own route family, presentation layer, catalogue experience, title/detail experience, watch experience, subscription entitlements and administration surface.

The existing Movies & TV product remains unchanged. The current `anime.html` page and its supporting implementation are intentionally untouched during the Premium build. Restricting that existing free anime experience is the final implementation task, after all six Premium phases have been integrated and tested.

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

All six phases are delivered in one pull request. The PR remains unmerged while the existing Anime page is subsequently limited as the final task. The final integration audit must cover Premium, the limited free Anime experience, Movies & TV and the shared Vivid account system together.

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
- The existing anime.html experience remains untouched. Premium playback and entitlement checks remain reserved for the later watch and membership phases.


## Phase 3 implementation — anime identity and title experience

- Each anime card in the Signature Worlds rail receives a deterministic title-specific SVG silhouette mask, layered poster artwork, a Vivid identity stamp and a title lockup. The whole card remains a stable anchor target.
- Mobile uses a simpler rounded poster fallback; dense shelves and catalogue grids keep conventional poster cards for scanning speed.
- Cards and the featured hero now open the dedicated anime-premium-title.html route with a validated numeric TMDB id and explicit movie/series type.
- The title route loads title metadata, cast, genres, recommendations and available official YouTube trailer links through the existing TMDB integration.
- The Living Cinematic Backdrop selects multiple images belonging to the same anime, preloads the next image before switching, crossfades two persistent layers over 1.8 seconds, and advances every 8.5 seconds. A subtle Ken Burns movement adds depth without interrupting the image transition.
- Backdrop motion respects reduced-motion preferences, overlapping transitions are prevented, and the hero artwork/content fades as the reader scrolls into the title details.
- Title discovery remains metadata-only: the page does not create a playback session or expose stream URLs. Playback and membership remain reserved for their later phases.
- The title route, stylesheet and runtime are added to the offline app shell and scoped syntax checks, with dedicated structural tests for the identity masks and backdrop lifecycle.


## Phase 4 implementation — protected watch experience

- Adds a dedicated anime-premium-watch.html route with a native video player shell, season selector, episode browser, previous/next navigation and responsive cinema layout.
- Episode and season metadata comes from TMDB; it is not treated as a playback source or entitlement.
- Playback requests are sent only to the Vivid-owned /api/anime-premium/playback endpoint with the existing Firebase user's ID token. The browser never constructs or falls back to third-party streaming embeds.
- A playback response is accepted only when it includes an HTTPS URL, a future expiry time and a supported media MIME type. Missing, unauthenticated, unentitled or unavailable responses fail closed with an explicit gate state.
- The protected playback endpoint and server-side membership/source resolution are intentionally reserved for Phase 5. Until then the player shell remains safely locked rather than inventing a stream.
- The watch route, stylesheet and runtime are included in the offline app shell, syntax checks and dedicated tests.


## Phase 5 implementation — Paystack, memberships and administration

### Server-owned payment flow
- Adds separate Cloudflare Pages API routes for public pricing, authenticated checkout, membership status, automatic renewal cancellation, Paystack webhook processing, protected playback and administrator operations.
- Checkout requires a verified Firebase ID token and verified email. The browser sends only country and payment method; amount, currency, plan code, reference, renewal mode and user identity are derived or verified server-side.
- Card checkout uses a configured Paystack monthly plan code and automatic renewal. Mobile money uses a one-time Paystack transaction and manual renewal. Mobile money is only offered for the currently supported GH/KE routes; the server validates this again.
- The existing displayed Ghana price is represented as a configurable default of 5330 minor units (GH₵53.30) via ANIME_PREMIUM_GHS_MONTHLY_AMOUNT. Additional supported checkout currencies and their Paystack plan codes are configured in ANIME_PREMIUM_PLANS_JSON. This is configuration, not a final locked global price.
- Country selection is populated from country/currency data; local-currency conversion is labelled as an estimate. Paystack's own checkout page displays the final billing currency and amount.
- Payment return never grants access. The signed Paystack webhook verifies its signature, verifies the transaction with Paystack, checks the stored checkout amount/currency/reference, and idempotently updates the membership document.
- Manual mobile-money renewals extend the existing entitlement period. Card subscription events maintain automatic-renewal state. Users can cancel card auto-renewal while retaining access through the paid period.

### Entitlement and playback security
- Firebase ID tokens are verified server-side; unverified email accounts cannot start checkout or use membership/playback APIs.
- Membership, checkout, webhook-event, source-registry and audit collections are explicitly denied to browser clients in Firestore rules.
- Playback checks the server-owned membership period before resolving an episode. The resolver is configured only through server secrets and the returned signed URL must be HTTPS, unexpired, use an allowed host and match an approved MIME type.
- No playback URL is accepted from client state or an arbitrary third-party embed. If no authorised resolver/source is configured, playback returns a closed 404/503 state.

### Administration
- Adds a restricted admin workspace and server endpoints for membership grant/revoke and authorised source mappings.
- Admin access is checked from Firebase admin claims or the server-side ANIME_PREMIUM_ADMIN_UIDS allowlist. Each manual membership/source change creates an audit record.
- Source records contain provider/source IDs only; direct stream URLs are not entered in the browser admin form.

### Required Cloudflare environment configuration before live payments
- FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID (existing Vivid server-side Firebase credentials).
- PAYSTACK_SECRET_KEY and PAYSTACK_WEBHOOK_SECRET (server secrets; never expose them to the browser).
- PAYSTACK_LIVE_ENABLED=true only in the production environment after the Paystack merchant, plan codes and webhook are configured. Checkout stays disabled in previews by default.
- PAYSTACK_PLAN_GHS_MONTHLY or ANIME_PREMIUM_PLANS_JSON for each enabled checkout currency. Card auto-renew is unavailable for currencies without a configured Paystack plan code.
- ANIME_PREMIUM_DEFAULT_CURRENCY (defaults to GHS) and optional ANIME_PREMIUM_GHS_MONTHLY_AMOUNT (defaults to 5330 minor units).
- ANIME_PREMIUM_ADMIN_UIDS for server-side admin allowlisting when custom admin claims are not used.
- ANIME_PREMIUM_STREAM_RESOLVER_URL, ANIME_PREMIUM_STREAM_RESOLVER_TOKEN and ANIME_PREMIUM_STREAM_HOSTS for an authorised playback resolver. Without these, the player remains safely unavailable.
- Configure the Paystack webhook URL as /api/anime-premium/webhook on the Vivid production origin. Support Vivid donations remain on their existing, separate payment flow.


## Third-party anime embed playback

VIVID ANIME PREMIUM uses the same iframe-provider model as the existing VIVID Cinema player. The Cloudflare playback endpoint verifies membership and issues a two-hour playback session; the browser then builds URLs from the static provider registry in `scripts/playback/anime-premium-providers.js`. Provider-specific postMessage events are accepted only from the active iframe's exact origin and window. See `docs/vivid-anime-premium-streaming-provider-research.md` for the provider list, route contracts, ID mapping and QA gates.

A provider's iframe route and published features do not guarantee that every title is indexed or that the provider is available in every territory. VIVID should measure actual title-level playback during QA and keep manual server switching available when a provider does not expose reliable readiness/error events.
