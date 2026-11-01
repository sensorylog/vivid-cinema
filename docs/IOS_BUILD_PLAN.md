# Vivid Cinema iPhone build plan

## Distribution target

- Public iPhone launch: keep the existing installable PWA as the zero-cost, worldwide route. Users install it from Safari using **Share → Add to Home Screen**.
- Native iOS: build and validate a Capacitor iOS application separately. A simulator build is not an installable signed IPA and does not grant public website distribution rights.
- Do not use Apple Enterprise certificates, shared signing certificates, paid signing services, or an App Store submission as a workaround for public distribution restrictions.

## Zero-paid-service constraints

- Reuse the existing public GitHub repository and existing application code.
- Use GitHub Actions macOS runners for unsigned simulator compilation. This repository is public; verify the current Actions quota and runner availability before relying on it.
- Do not add paid hosting, CI, analytics, authentication, media, or build dependencies.
- Keep existing Firebase and hosting usage within their current free allowances. Stop and ask before any change that could create a bill.
- The iOS platform package is installed transiently in CI at the exact Capacitor version already used by this repository. It is not yet a committed dependency or a locally reproducible native setup; promote it into the lockfile only after the first CI build proves the integration.

## Implementation sequence

1. Establish a clean baseline and inspect the existing Android Capacitor work without merging it.
2. Add an unsigned iOS Simulator build that runs the existing tests and syntax checks first.
3. Validate the generated iOS project and resolve compile-time integration issues.
4. Audit iPhone-specific authentication, safe areas, playback, fullscreen, media controls, persistence, and external links.
5. Keep the PWA install path polished for public users while native iOS distribution remains subject to Apple's eligibility and signing rules.
6. Only after CI and device testing pass, prepare a reviewable pull request. Do not merge or release automatically.

## Known limitations

- The current repository has a Capacitor Android configuration but no tracked `ios/` project and no `@capacitor/ios` dependency in its package manifest.
- An unsigned Simulator build is for engineering validation only. It cannot be installed on a physical iPhone as a normal consumer app.
- Physical-device native installation and public native distribution may require Apple signing/program access. No paid route is assumed or authorised by this plan.
