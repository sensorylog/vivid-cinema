# Vivid Cinema

## Phase D4 — PWA foundation and offline shell
Vivid Cinema now has the first production-oriented PWA layer:
- installable web-app manifest with standalone display
- dedicated Vivid app icon asset
- service worker registration
- versioned application-shell cache
- network-first navigation with cached fallback
- cache-first same-origin static assets
- automatic cache cleanup on service-worker activation
- browser install prompt when the platform exposes it
- mobile-safe install control placement
- PWA metadata wired across the primary app surfaces

The service worker intentionally stays conservative: it caches the application shell and same-origin static resources, but does not proxy third-party TMDB, YouTube, Firebase or CDN requests. Dynamic catalogue data therefore remains network-dependent while the application shell can reopen offline.

The PWA layer does not add streaming or download functionality.

Runtime/device PWA verification is still pending. In particular, install prompts, iOS home-screen behavior, service-worker lifecycle, offline navigation and Firebase/TMDB behavior should be tested on real devices before launch.

## Phase D3 — Account and viewing preferences
The account surface now provides a dedicated premium profile experience with:
- display-name editing
- sign-in method and email-verification status
- authenticated Firestore profile persistence
- provider-region preference shared with title availability discovery
- trailer autoplay preference
- reduced-motion preference
- local library counts for Favorites, Watch Later and History
- reliable auth navigation event handling

Preferences are stored under the authenticated user's `users/{uid}` document and mirrored locally where they affect immediate browser behavior. Account data remains owner-scoped by the D1 Firestore rules.

The D2 local-first library synchronization remains unchanged. Runtime/browser QA and deployed Firestore-rule verification are still pending.

## Phase D2 — Authenticated library synchronization
The C5 local library now synchronizes with the signed-in user's Firestore space. On authenticated load, remote favorites, watch-later items and history are merged with the local device library, then the merged state is written back to the user's owner-scoped collections. Local changes also attempt to persist remotely while keeping the local UI responsive. Signed-out users continue using the device-local library.

The sync is intentionally local-first and non-destructive: C5 data is merged by typed `movie:id` / `tv:id` identity. Firestore rules remain UID-scoped from D1. Runtime/browser and deployed-rule testing is still pending.

## Phase D1 — Account and authentication foundation
Phase D begins with the account foundation. Email/password accounts now send verification email before access, password reset remains available, and Google sign-in is supported through Firebase Authentication. User records are initialized in Firestore. `firestore.rules` scopes account and personal-library paths to the authenticated owner only.

Before production use, enable the Google provider in the Firebase Authentication console and deploy/test the Firestore rules against the Vivid Cinema Firebase project. Browser/device runtime QA remains pending.

## Phase C5 — Personal library foundation
The new local-first library surface gives users a dedicated place for favorites, watch-later titles and recently opened history. Title pages can save/remove favorites and watch-later items, and opening a title records a compact history entry. The library is intentionally device-local in C5; authenticated Firestore synchronization remains Phase D.

The canonical route is `library.html`, with the shared typed media identity preserved across movie and TV entries. The implementation does not add playback, downloads or unauthorized provider access.

Vivid Cinema is being rebuilt as a premium cinematic web app and installable PWA.

## Phase C4 — Title experience and legitimate viewing discovery
The title surface now has a stronger legitimate viewing-discovery layer:
- trailer and clip gallery using YouTube metadata supplied by TMDB
- in-page trailer viewer with keyboard Escape close support
- provider country selector using available TMDB country data
- remembered provider-country preference
- provider groups for stream, free, rent and buy listings
- explicit note that Vivid Cinema does not host or provide titles
- lazy-loaded cast, trailer and similar-title imagery
- mobile-responsive provider and video layouts
- reduced-motion support

Provider links point to TMDB's country-level availability link; Vivid does not proxy or embed unauthorized playback.

Browser/device QA is still pending; this phase does not claim runtime verification.

## Phase C3 — Discovery and search
The dedicated discover.html surface provides movie/TV/all-content discovery, search, dynamic genres, year filtering, sorting, pagination, loading/empty/error states and typed title links. The old watch.html?id=... route now redirects to the canonical title.html route.

## Phase C2 — TV seasons and episodes
TV title pages now expose a season selector and episode browser backed by the shared TMDB client. Episode stills, air dates, ratings and synopses are presented as discovery information only; Vivid Cinema does not host or stream episodes.

## Phase C1 — Title detail foundation
The title route is a dedicated cinematic detail surface. It resolves typed movie/TV URLs through the shared TMDB client, renders poster/backdrop metadata, genres, cast, trailers, legitimate watch-provider discovery, and similar titles.

## Phase B — Cinematic experience
Premium landing page, signature swipeable trailer hero, discovery rails and featured content.

## Phase A — Foundation
Shared configuration, TMDB client/cache, content orchestration, app shell, temporary library adapter, runtime readiness and design-system primitives.

## Phase D — Personal app + PWA
Firebase Auth, verification/reset, Firestore-synced library, install/offline shell.

## Phase E — Launch
Performance, accessibility, security, legal, QA and production hardening.


## Phase D6 — VidAPI viewing integration

- Added a dedicated Vivid Cinema watch experience at `watch.html`.
- Movie playback uses the VidAPI embed route `/embed/movie/{tmdbId}`.
- TV playback uses `/embed/tv/{tmdbId}/{season}/{episode}`.
- Title pages now expose a primary **Watch now** action.
- TV episode cards now expose direct **Play episode** actions.
- Playback records the title in the existing History library.
- VidAPI is embedded in a responsive, fullscreen-capable iframe with a Vivid cinematic shell.
- VidAPI's documented embed host is configurable through `VIVID_CONFIG.vidapiEmbedBaseUrl`.
- The current configuration uses VidAPI's documented embed host `https://vaplayer.ru`.
- The VidAPI account/domain should have the Vivid domain added to its Allowed Sites whitelist where enabled.
- The VidAPI custom-domain flow uses DNS CNAME verification; `vidapi-ip.org` is the DNS target, not an iframe URL.
- Service-worker shell cache upgraded to v3 and now includes the watch page, player module, and watch styles.
- No movie/episode files are downloaded or proxied through Vivid's own server.
- Browser/device playback QA is still required on the deployed Firebase Hosting site.


## Phase E — Launch hardening

Phase E prepares the rebuilt Vivid Cinema experience for production without changing the core product direction: discover a movie or TV series, open its title page, and watch through the configured VidAPI player.

### Included
- Replaced the old landing page with a canonical redirect to the cinematic home experience
- Branded Firebase 404 page
- Rebuilt Terms, Privacy and Contact surfaces to match Vivid Cinema
- Added shared legal-page styling
- Added robots.txt and a lightweight sitemap for the Firebase-hosted public surfaces
- Added PWA shortcuts for Browse, Discover and My Library
- Expanded the service-worker shell to include legal/support pages and launch metadata
- Upgraded the shell cache to v4
- Offline navigation now falls back to the dedicated offline page before home
- Preserved third-party boundaries: TMDB, YouTube, Firebase and VidAPI remain external services
- No new paid infrastructure, custom domain or Cloudflare dependency

### Launch QA still required
No browser/device or production-hosting QA has been run by this phase. Before calling Vivid Cinema production-ready, verify on the deployed Firebase URL:
- movie playback through VidAPI
- TV season/episode playback
- mobile and desktop player behavior
- Firebase Auth and Firestore library synchronization
- PWA install/update/offline behavior on iOS and Android/Chromium
- navigation, search and title links
- contact form delivery
- legal/support pages and 404 behavior
- accessibility with keyboard and reduced-motion settings

Phase E deliberately avoids claiming runtime success until those checks are performed on the deployed site.
