# Vivid Cinema

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
Firebase Auth, verification/reset, optional Google sign-in, Firestore-synced library, install/offline shell.

## Phase E — Launch
Performance, accessibility, security, legal, QA and production hardening.
