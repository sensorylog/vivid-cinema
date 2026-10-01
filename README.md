# Vivid Cinema

Vivid Cinema 2.0 is being rebuilt as a premium cinematic movie/TV discovery web app and installable PWA.

## Build phases

- A — Foundation: architecture, shared data layer, utilities, design tokens, Firebase foundation.
- B — Cinematic Experience: premium landing page, swipeable trailer hero, home discovery rails.
- C — Discovery: movies, TV, search, title pages, provider discovery.
- D — Personal App: authentication, synced library, account, PWA/offline experience.
- E — Launch: performance, accessibility, security, legal, QA and production hardening.

## Phase A foundation modules

- scripts/config.js — centralized app/API configuration.
- scripts/tmdb.js — single TMDB client with request timeout and in-memory response cache.
- scripts/content.js — home/featured content orchestration.
- scripts/utils.js — shared rendering/data utilities.
- scripts/app-shell.js — shared viewport/app-shell bootstrap.
- scripts/library.js — temporary local library adapter used while Firestore sync is built in Phase D.
- styles/vivid-foundation.css — Vivid 2.0 design tokens and restrained liquid-glass primitives.

The current legacy UI remains intact on this branch while the new foundation is introduced incrementally. No unauthorized streaming/download functionality is part of the 2.0 architecture.
