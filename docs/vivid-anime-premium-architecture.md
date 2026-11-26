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
4. Verify signed Paystack webhook events against the unmodified request body and validate the exact pending order.
5. Process webhook events idempotently before activating the UID-owned entitlement.
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
- The live Anime Premium page uses the three owner-created Paystack hosted Payment Pages; it does not create a second checkout product or initialize a separate transaction for these plans.
- The server maps the selected billing period to a fixed, server-owned page URL and fixed GHS amount: monthly GH₵53.30, six months GH₵287.82, annual GH₵511.68.
- Before redirecting, the authenticated Pages Function verifies the Firebase ID token and verified account email, creates a pending checkout record tied to the Firebase UID, and supersedes older pending attempts for that same account. It pre-fills the hosted Paystack page email and marks the email field read-only using Paystack's supported URL parameters.
- The browser never supplies the account UID, payment amount, page URL or entitlement duration. The server owns all of those values.
- The Paystack hosted page performs the payment. A signed `charge.success` webhook is the authoritative payment confirmation. For hosted-page transactions, the webhook's Paystack-generated reference is matched to exactly one recent pending checkout using verified account email, fixed plan amount and GHS currency. Ambiguous matches are not granted automatically.
- Hosted-page fulfilment uses the authenticated Paystack webhook signature and validates success status, exact amount and currency. It does not call transaction initialization or transaction verification APIs for the hosted-page redirect flow. The older API-initialized checkout path retains its server-side transaction verification.
- `PAYSTACK_WEBHOOK_SECRET` is the preferred server-only webhook signing secret. `PAYSTACK_SECRET_KEY` is not required to open or pay through the three hosted pages; it remains an optional fallback for legacy webhook signatures and the older API-initialized checkout route. Never expose either secret to browser code.
- Paystack subscription pages should be configured as recurring subscription pages with the correct plan interval. When Paystack supplies a subscription code, Vivid records automatic renewal; otherwise the entitlement is treated as manual renewal rather than claiming an unverified recurring arrangement.
- Configure each of the three Paystack pages to redirect after payment to `https://vivid-cinema.pages.dev/anime-premium-return.html`. The return page only polls Vivid's server-owned membership status; it never grants access from a browser redirect.
- Configure the Paystack webhook URL as `https://vivid-cinema.pages.dev/api/anime-premium/webhook`. The webhook signing secret must be stored in Cloudflare Pages production secrets as `PAYSTACK_WEBHOOK_SECRET`.
- Country selection is populated from the complete country/currency dataset; local-currency conversion is labelled as an indicative reference estimate. Paystack still charges the fixed GHS amount shown on the selected hosted page, and the card issuer/payment provider determines any final conversion and fees.
- Voluntary Support Vivid donations remain separate and continue to use their existing Paystack Inline public-key flow.
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
- PAYSTACK_WEBHOOK_SECRET (required server-only signing secret for the three hosted Premium Payment Pages; never expose it to the browser).
- PAYSTACK_SECRET_KEY is not required for the hosted-page redirect or signed-webhook fulfilment. It is retained only for the older API-initialized checkout route and legacy webhook signature compatibility.
- Do not require PAYSTACK_LIVE_ENABLED or Paystack plan-code environment variables for the three fixed hosted Payment Pages. Those settings belong to the older API-initialized checkout path.
- ANIME_PREMIUM_ADMIN_UIDS for server-side admin allowlisting when custom admin claims are not used.
- Configure the Paystack webhook URL as https://vivid-cinema.pages.dev/api/anime-premium/webhook on the Vivid production origin and save the matching signing secret in Cloudflare Pages Production as PAYSTACK_WEBHOOK_SECRET.
- Set the Redirect after payment URL on all three hosted Payment Pages to https://vivid-cinema.pages.dev/anime-premium-return.html. The return page only checks membership; the signed webhook activates it.
- Support Vivid donations remain on their existing, separate Paystack Inline public-key flow.


## Third-party anime embed playback

VIVID ANIME PREMIUM uses the same iframe-provider model as the existing VIVID Cinema player. The Cloudflare playback endpoint verifies membership and issues a two-hour playback session; the browser then builds URLs from the static provider registry in `scripts/playback/anime-premium-providers.js`. Provider-specific postMessage events are accepted only from the active iframe's exact origin and window. See `docs/vivid-anime-premium-streaming-provider-research.md` for the provider list, route contracts, ID mapping and QA gates.

A provider's iframe route and published features do not guarantee that every title is indexed or that the provider is available in every territory. VIVID should measure actual title-level playback during QA and keep manual server switching available when a provider does not expose reliable readiness/error events.
