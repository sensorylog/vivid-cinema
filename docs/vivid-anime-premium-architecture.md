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
