# Vivid Cinema performance programme

This document tracks the four phases of the shared web + desktop performance overhaul. The work is intentionally kept on one pull request so the full change can be reviewed and tested together.

## Engineering principles

- Preserve Vivid's visual identity and product capabilities.
- Optimise the shared web application first; Electron must not be the only place that receives performance treatment.
- Prefer measured bottlenecks over aesthetic guesses or blanket CSS removal.
- Treat low-end hardware as a supported target, not as an excuse for broken interactions.
- Do not claim a performance improvement without a reproducible before/after measurement.

## Four phases

### Phase 1 — establish the baseline and close the browser/Electron gap

- Audit page entry points, shared CSS, JavaScript startup and existing performance protections.
- Apply the existing legacy visual profile consistently in normal browsers and Electron.
- Add deterministic tests for capability detection, idempotence and standard-device behaviour.
- Record known risks and a repeatable manual profiling protocol.
- Do not claim measured frame-rate or Core Web Vitals gains until real browser runs are captured.

### Phase 2 — rendering and GPU cost

- Profile the atmosphere layer, backdrop filters, blend modes, shadows, transforms and animated decoration.
- Reduce paint/compositing work where traces show a cost.
- Preserve the premium look on capable hardware and degrade gracefully on constrained devices.
- Verify scroll and animation behaviour with Chrome DevTools Rendering and Performance tools.

### Phase 3 — page workload and scheduling

- Audit Home, Discover, Library, For You and other slow routes for DOM volume, synchronous work, eager imports, repeated listeners and image decode pressure.
- Defer noncritical work based on visibility/idle time without delaying essential controls or content.
- Avoid large DOM rebuilds and unnecessary event handlers.
- Add targeted regression tests around the measured causes.

### Phase 4 — verification and regression protection (CI verification complete; hardware profiling outstanding)

- Run the full repository regression suite, syntax checks, static validation and cross-browser navigation smoke tests.
- Compare representative pages on constrained and modern hardware.
- Capture cold/warm navigation, scroll, input responsiveness, CPU, memory, DOM nodes, style/layout recalculations and long tasks.
- Add sustainable performance budgets or automated checks only where the environment can measure them reliably; do not invent thresholds without a baseline.
- Document remaining trade-offs and confirm that visual/functional behaviour remains intact.

## Phase 1 audit findings (source inspection)

- The Electron preload already detects devices with at most two logical cores or at most 4 GB reported device memory and loads `styles/vivid-performance.css`.
- The same shared profile was not applied by the normal browser app shell, creating inconsistent treatment between browser and Electron.
- Home already defers optional fonts, icon CSS, atmosphere, ambient artwork and hero setup until after first paint; secondary shelves are visibility-triggered and Home shelves use `content-visibility`.
- The existing performance tests are largely source-structure checks. They do not establish real frame rate, INP, long-task duration or layout/paint cost.
- Shared atmosphere styling includes a fixed blurred pseudo-element and a full-viewport blend-mode overlay. These are candidates for Phase 2 profiling, not proven causes yet.
- Page entry points have different CSS and script stacks. For example, For You includes the Recall chat module and Library loads its own page stylesheet; route-specific costs need route-by-route measurement.

## Manual profiling protocol

For each representative route, use a fresh browser tab and record:

1. Chrome DevTools Performance: cold load, warm load, 10 seconds idle, 30 seconds vertical scroll, 10 horizontal-rail swipes, and repeated primary interactions.
2. Performance Monitor: CPU, JS heap, DOM nodes, event listeners, documents/frames, layouts per second and style recalculations per second.
3. Rendering panel: FPS meter and paint flashing while scrolling.
4. Network: CSS/JS request count, transfer size, cache status, image request count and decode timing.
5. Record hardware, browser version, viewport, network conditions and whether the legacy profile activated.

A before/after comparison is only valid when route, viewport, browser, cache state and interaction script are held constant.


### Phase 2 — adaptive rendering and compositing (implemented; runtime measurement pending)

- Refined the shared constrained-device stylesheet rather than adding another visual mode or changing page architecture.
- Stopped the animated, 48px-blurred fixed atmosphere layer on constrained devices while retaining a static low-cost light field.
- Changed the full-viewport screen-blended overlay to a restrained normal-blend overlay to avoid expensive blend compositing.
- Removed duplicated blurred card-art pseudo-elements and hover sheen on constrained devices while keeping cards, content, layout and restrained static depth shadows.
- Disabled backdrop-filter sampling on sticky navigation and Home rail controls; retained their translucent backgrounds and controls.
- Added source-contract tests for these adaptive rendering rules.
- This is a targeted source-level reduction in known expensive rendering primitives, not a measured FPS/INP claim. Browser trace comparison remains required in Phase 4.

#### Phase 2 findings and guardrails

- Home's poster collage and repeated rail measurements were already addressed by the existing Home work; Phase 2 does not duplicate those changes.
- The shared atmosphere pseudo-elements remained active across app routes: a fixed animated blurred layer and a screen-blended viewport overlay. These are now simplified only for constrained devices.
- Capable devices keep the existing full cinematic effects. No content, routes, playback, navigation or feature behavior is removed.


### Phase 3 — page workload and event scheduling (implemented; runtime measurement pending)

- Audited the Home, Discover and For You route scripts, shared app shell, image-loading markup and page entry points.
- Found that Home's `wireCards()` walked every poster card after each rail render and allocated separate click and keydown closures for each card. Re-rendered rails repeated this work.
- Replaced per-card handlers with one delegated click handler and one delegated keyboard handler per rail container. A `WeakSet` makes registration idempotent without retaining removed rail nodes.
- Preserved card navigation, continue-watching resume URLs, recommendation-click telemetry, keyboard activation and Coming Soon reminder buttons.
- Existing route optimisations were retained: Home already uses lazy/async poster images, visibility-triggered secondary shelves, and idle-scheduled recommendations; Discover category artwork already hydrates on intersection; For You already uses lazy/async images and visibility-based recommendation impressions.
- Added a regression contract to prevent per-card listener allocation from returning.
- Source inspection did not justify a broad rewrite of Discover/For You or a framework change. No blanket DOM or image-loading changes were made without a measured trace.
- Runtime impact remains unmeasured; Phase 4 must compare event-listener count, main-thread time and interaction latency on representative routes.


## Phase 4 verification record

### Automated verification observed on the Phase 4 review pass

The following GitHub Actions results were observed for head commit `6463326a6f83f24503d60db11cdf093a25784f08`:

| Workflow | Observed result |
| --- | --- |
| Tests (full Node test suite + syntax check) | Passed |
| Quality checks (including Firestore emulator tests) | Passed |
| Vivid Cinema CI (static validation, regression tests, syntax/import/asset checks, Cloudflare Functions bundle) | Passed |
| Windows desktop build | Still running; installer/portable packaging step active |
| Android APK build | Passed |
| Browser navigation smoke tests | Passed (Chromium and WebKit) |

The combined commit-status endpoint also reported two failed Netlify deploy-preview contexts. These are deployment-preview failures, not evidence that the test suite failed; they still need investigation before treating preview deployment as healthy. Workflow states can change after this snapshot and must be refreshed before merge. The Android APK and browser navigation jobs were subsequently refreshed and both completed successfully; the Windows installer/portable packaging job remained in progress.

### What these checks do and do not prove

- The passing test workflows establish that the repository's automated regression, syntax and static-validation suites passed for the reviewed commit.
- Existing performance regression tests cover conservative hardware detection, one-time stylesheet injection, preservation of the standard visual profile, constrained-profile rendering rules, and delegated Home-card event wiring.
- Browser navigation smoke tests passed in Chromium and WebKit; they are not a substitute for a performance trace.
- No real FPS, INP, CPU, GPU, memory, long-task, layout or paint measurements have been collected on either the target Core 2 Duo / 4 GB machine or a modern reference machine.
- No numeric performance budget has been introduced. Without repeatable browser traces and a stable runner, a hard FPS or timing threshold would be arbitrary and could create false failures.

### Required hardware comparison before Phase 4 can be called complete

Run the same build and repeatable interaction script on (A) the target low-end PC and (B) a modern reference machine. Record browser/Electron version, OS, viewport, display scale, power mode, network, cache state and whether `vivid-performance-legacy` is present. For Home, Discover, Library and For You, capture:

1. Cold navigation and a second warm navigation.
2. Ten seconds idle, 30 seconds vertical scrolling, ten horizontal-rail swipes, and repeated primary actions.
3. Chrome/Chromium Performance traces and Performance Monitor samples: CPU, JS heap, DOM nodes, event listeners, layouts/sec and style recalculations/sec.
4. FPS meter / paint flashing during scrolling, plus long tasks and interaction latency.
5. Functional/visual checks: card navigation, keyboard activation, resume playback, Coming Soon reminders, rail controls, sticky navigation, poster visibility and route transitions.

Compare like-for-like traces. Record actual values and attach the trace files; do not infer improvement from the device profile activating or from a source diff alone.

**Phase 4 status: not complete yet.** Automated regression checks have passed where reported above, but final browser smoke/build jobs were still in progress at the snapshot, deploy previews reported failures, and the required real-hardware performance comparison has not been run. Keep PR #508 open and in draft until these gaps are closed.


### Release packaging follow-up

- Prepared package version `1.0.46` consistently in the root package manifest/lockfile and the isolated desktop runtime manifest/lockfile.
- Removed the Windows release workflow's wait for `Vivid-Cinema-Android.apk`; Windows publication now verifies only its own installer, portable executable, blockmap and updater metadata. The signed Android release workflow remains independently responsible for uploading the APK to a matching release when Android is ready.
- Added a desktop packaging contract assertion to prevent the Windows release from becoming coupled to the Android APK again.
- These release-path changes are on the same PR and must pass a fresh CI run before merge. Version `1.0.46` is prepared but is not published yet.
