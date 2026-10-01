# Vivid Cinema

Vivid Cinema is being rebuilt as a premium cinematic web app and installable PWA.

## Phase A5 — Runtime readiness
The migrated data modules are now loaded as ES modules on their consuming pages. This closes a critical integration gap introduced during A4: `script.js`, `hamburger.js`, and `watch.js` all use imports and must therefore be loaded with `type="module"`. The landing page also initializes the shared app shell.

The home filter markup no longer contains hard-coded genre/year values that conflict with the dynamic TMDB genre/year population. User-facing TMDB timeout/rate-limit/server errors now have a shared message helper for the next UI migration.

Browser/device QA is still pending; this phase intentionally does not claim runtime verification.

## Phase A4 — Data and content architecture
The data layer now has a canonical media model in `scripts/media.js`. Movie/TV results carry an explicit `media_type` and collision-safe `content_id` (`movie:123` / `tv:123`). TMDB access, timeout/error handling, detail endpoints, discovery, genres and similar-title pagination are centralized in `scripts/tmdb.js`. Home/search/filter consumers use `scripts/content.js` and the shared client instead of embedding their own API requests.

Title URLs accept an explicit `type` query parameter when known, avoiding unnecessary movie/TV detection requests. The temporary local library also uses typed keys so a movie and TV show with the same numeric TMDB ID cannot collide.

The TMDB browser key remains configuration rather than a secret; production security hardening and any server-side proxy decision are deferred to the later security/launch work so the free static-hosting architecture is not accidentally replaced.

## Phase A3 — App shell architecture
The shell now owns page identity, responsive viewport state and online/offline state. Route construction and query parsing live in `scripts/routes.js`, while safe-area and shell readiness primitives live in `styles/vivid-shell.css`. This is deliberately framework-neutral so the legacy site can migrate incrementally.

## Phase A2 — Design system
The A2 layer establishes reusable primitives before the final cinematic UI:
- typography hierarchy and system-font strategy
- 4px-based spacing scale
- responsive content gutters and layout primitives
- restrained liquid-glass surfaces
- buttons, icon buttons, cards, pills and form controls
- skeleton/loading state
- keyboard-visible focus treatment
- reduced-motion support
- mobile touch-target rules

**Glass:** a depth treatment, not a default background. Use it selectively for navigation, floating controls, overlays and selected surfaces.

**Content:** strong hierarchy, compact metadata and minimal text walls.

**Motion:** communicate state and spatial relationships; honor reduced-motion preferences.

## Roadmap
### Phase A — Foundation
Shared configuration, TMDB client/cache, content orchestration, app shell, temporary library adapter and base tokens.

### Phase B — Cinematic experience
Premium landing page, signature swipeable trailer hero, discovery rails and featured content.

### Phase C — Discovery and content
Movies, TV, search, title details, seasons, cast, trailers and legitimate watch-provider discovery.

### Phase D — Personal app + PWA
Firebase Auth, verification/reset, optional Google sign-in, Firestore-synced library, install/offline shell.

### Phase E — Launch
Performance, accessibility, security, legal, QA and production hardening.
