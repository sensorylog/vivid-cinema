# Vivid Cinema — conservative whole-site audit

**Scope:** source inspection of the current `main` branch on 2026-10-09. This is a code-review record, not a claim that the site has passed real-device QA.

## Safety rule

Do not refactor shared CSS, navigation generation, playback providers, authentication, Firestore rules, service-worker caching, or payment flows in a broad batch. These systems cross page boundaries. Make small changes only when a concrete defect is demonstrated, with a before/after test and a rollback path.

## Confirmed observations

### 1. The shared CSS cascade is difficult to reason about

Measured from the current source files:

| Stylesheet | Approx. bytes | `!important` declarations |
|---|---:|---:|
| `styles/vivid-system.css` | 26,988 | 32 |
| `styles/vivid-shell.css` | 15,989 | 29 |
| `styles/vivid-home.css` | 31,866 | 315 |
| `styles/vivid-home-breathe.css` | 9,808 |  — |
| `styles/vivid-desktop.css` | 14,644 | 201 |
| `styles/vivid-audit-fixes.css` | 56,659 | 530 |
| `styles/vivid-liquid-glass.css` | 67,381 | 679 |

Counts are a complexity signal, not proof that each declaration is wrong. Do not remove them mechanically.

The home, search, library, watch, and landing pages load different combinations and orders of shared/page-specific CSS. For example, the home page loads its page-specific styles and desktop corrections before `vivid-liquid-glass.css`; search loads the audit-fixes sheet before standalone-search and desktop styles, then liquid-glass last. This means comments claiming that the audit-fixes sheet is universally “loaded last” do not describe the actual page cascade.

**Safe decision:** no cascade consolidation in this pass. First build a per-page stylesheet map, identify duplicate/conflicting selectors, then validate each proposed reduction in screenshots and interaction tests.

### 2. Home navigation is dynamically rebuilt

`scripts/app-shell.js` reconstructs the desktop navigation and explicitly preserves the home-page release-alert button. Because it replaces `nav.innerHTML`, any other behavior-bound child that is not explicitly preserved could be lost if the markup changes.

**Safe decision:** do not edit navigation generation without testing every page, active-page state, search trigger, auth link, release-alert control, mobile navigation, and keyboard focus.

### 3. Search page has explicit safe rendering and recoverable empty/error states

`scripts/search-page.js` escapes dynamic titles, query text, image URLs and recent-search labels before inserting markup. It has empty, loading, no-result and failure states. Search is submitted with Enter and recent searches can be selected or cleared.

**Safe decision:** no speculative rewrite. Browser QA should verify Enter submission, clear/reset, recent search, network failure, and navigation to movie, TV and person detail pages. Consider debounced live search only if it is an intentional product decision; it is not a correctness fix by itself.

### 4. Library rendering depends on shared local/cloud state and routes

`scripts/library-page.js` renders Continue Watching, collection counts, empty states, and item removal through the existing library and recommendation modules.

**Safe decision:** preserve these data paths. Test favorites, Watch Later, history, Continue Watching, remove/clear actions, signed-in sync, and signed-out behaviour before any refactor.

### 5. Playback has multiple provider/fallback paths

`scripts/watch.js` coordinates multiple embed providers, anime-specific identifiers, episode routing, and playback-progress synchronization. This is high regression risk.

**Safe decision:** no playback-provider or fallback changes without a reproducible issue and a test for movie playback, TV season/episode navigation, fallback, resume progress, and anime routing.

### 6. PWA behaviour is global and stateful

`scripts/app-shell.js` loads `scripts/pwa.js`. PWA code manages service-worker registration, installation prompts, offline messaging, and a persistent install-guide dismissal flag.

**Safe decision:** do not change service-worker cache versions or install-guide timing during visual cleanup. Verify online/offline state, install/dismiss behaviour, installed-app mode, and an update from a previously cached build.

## Risk-ranked plan

### P0 — protect existing behaviour
- Run existing CI and Firestore rules tests.
- Establish baseline screenshots and smoke tests for landing, home, discovery, search, title/person detail, watch, library, live, news, authentication, legal pages and support.
- Test mobile width and desktop width; check keyboard-only navigation and reduced motion.
- Verify payment and authentication flows in a safe test context; never make a real charge just to test UI.

### P1 — safe, isolated fixes
- Fix only reproducible broken controls, invalid links, obvious overflow, focus visibility, missing accessible names, and broken empty/error states.
- Prefer a page-scoped stylesheet or component-level change over a global selector.
- Keep changes separate by concern and run checks after each batch.

### P2 — design-system cleanup (defer until visual baselines exist)
- Map repeated selectors and conflicting declarations across page stylesheets.
- Identify token mismatches and duplicate CSS rules.
- Consolidate one component family at a time; compare screenshots across every affected page and viewport.
- Remove obsolete rules only after confirming no current HTML or script depends on them.

### P3 — measured performance improvements
- Measure real network requests, render timing, layout shifts, image loading, and interaction responsiveness before optimizing.
- Avoid speculative CDN removal, script deferral, image changes, or service-worker changes without a measured problem.

## Required smoke-test matrix

| Area | Minimum checks |
|---|---|
| Landing | Main CTA, navigation, legal links, first render |
| Home | Search dialog, release alert, title rails/cards, account state |
| Discovery/search | Query, Enter, clear, recent searches, no results, API failure |
| Details | Correct title, artwork, metadata, watch/save actions |
| Watch | Movie, TV episode changes, provider fallback, resume/history |
| Library | Favorites, Watch Later, history, Continue Watching, removal |
| Account | Sign-in/out, session persistence, protected actions |
| PWA | Install/dismiss, offline message, cached update |
| News/community | Public reads, signed-in participation, moderation boundaries |
| Support | GHS checkout handoff/cancel/success, international handoff; no real charge in QA |
| Responsive/accessibility | Small phone, larger phone, desktop, keyboard focus, reduced motion |

## Release gate

Do not merge or deploy an audit change merely because the code looks cleaner. Each change must have a stated user benefit, a bounded scope, checks appropriate to its risk, and a rollback path. If a safe test cannot be performed, leave the behaviour untouched and document the limitation.
