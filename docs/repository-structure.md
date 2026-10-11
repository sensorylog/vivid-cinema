# Repository Structure and Change Boundaries

This guide describes the current intended ownership boundaries for Vivid Cinema. It complements `architecture-audit-phase-a-baseline.md`; the baseline document records the pre-cleanup tree, while this guide describes the structure after the initial playback-module grouping.

## Public static site

- Root HTML files are public entry points. Keep existing filenames, direct URLs, query parameters, and hash routes stable.
- `styles/` contains shared stylesheets and page/component styles. Do not consolidate CSS based on filenames alone; inspect page usage, cascade order, breakpoints, and computed behavior first.
- `icons/`, `images/`, and other static-asset directories contain public assets. Check references in HTML, CSS, JavaScript, and the service-worker cache before renaming or moving anything.
- `service-worker.js` is a browser entry point, not an ordinary application module. Cache-list changes require a cache-version review and an upgrade/offline regression check.

## JavaScript ownership

- `scripts/` contains page controllers, shared application modules, and browser entry points.
- `scripts/playback/` contains modules that implement or directly support playback:
  - `player-engine.js` — authorized direct-stream player lifecycle and integration.
  - `playback-urls.js` — built-in provider URL builders.
  - `playback-servers.js` — custom playback-server registry, validation, and persistence.
  - `server-settings.js` — custom-server management UI.
  - `tflix-secondary-player.js` — independent secondary-player server list and URL routing.
  - `direct-stream-validation.js` — validation helpers used by the direct-stream engine.
- `scripts/watch.js` remains the watch-page controller and imports playback modules through `scripts/playback/`. Keep provider-specific routing in the provider modules instead of duplicating it in the page controller.
- `scripts/config.js` remains in the parent `scripts/` directory and is shared configuration. Modules in `scripts/playback/` import it using `../config.js`.
- `automation/` contains repository maintenance and operational scripts. Keep package-script and workflow references synchronized if one of these files is moved.

## Tests and CI

- `tests/` contains regression tests. Tests that read source files by path must be updated when a module is moved.
- `package.json` defines the root test and syntax commands.
- `tests/package.json` defines the nested Firestore emulator test command and its dependency set. Treat it as a distinct test environment until the two Firestore test files and dependency requirements have been compared.
- `.github/workflows/ci.yml` and `.github/workflows/quality.yml` have overlapping but not identical checks. Do not consolidate them until every unique check has an owner and equivalent coverage is demonstrated.

## Firebase and release configuration

- `firebase.json`, `firestore.rules`, and `firestore.indexes.json` are deployment/security configuration. Review changes independently from ordinary file organization.
- `functions/` contains deployed backend functions; changes can affect production behavior and should have their own tests/release review.
- `docs/` is excluded from Firebase Hosting by the current ignore configuration, so architecture/runbook documentation can be added without exposing it as a public site asset.

## Safe change protocol

For every structural change:

1. Search all imports, HTML/CSS references, test source reads, service-worker precache entries, workflow/package scripts, and documentation links.
2. Make one cohesive move or responsibility change at a time.
3. Update the references and tests in the same change.
4. Run the relevant focused tests and the complete CI suite.
5. Confirm no public URL or Firebase deployment contract changed unintentionally.
6. For playback/service-worker changes, test a browser session with a previous cached version as well as a clean session.
7. Keep production browser/device playback and deployed Firebase security/header checks as explicit release gates.

Do not delete code solely because it appears unused in one search result. Confirm that it is not dynamically loaded, referenced by the service worker, used by tests/automation, or intentionally retained for compatibility.
