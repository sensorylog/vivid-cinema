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

### Phase 4 — verification and regression protection

- Compare representative pages on constrained and modern hardware.
- Capture cold/warm navigation, scroll, input responsiveness, CPU, memory, DOM nodes, style/layout recalculations and long tasks.
- Add sustainable performance budgets or automated checks where the environment can measure them reliably.
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
