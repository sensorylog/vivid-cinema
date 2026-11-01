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
- The iOS platform package is installed transiently in CI at the exact Capacitor version already used by this repository. It is not yet a committed dependency or a locally reproducible native setup; promote it into the lockfile only after reviewing the generated Xcode project and lockfile changes.

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

## First simulator milestone (confirmed)

- The unsigned iOS Simulator app compiled successfully in GitHub Actions on 2026-11-01 on the current PR head commit `4a22ea7b7c1edf1117d85e58bf182021d41cd701`.
- The job passed the full project test suite and syntax checks, generated/synced the Capacitor iOS project, compiled the Simulator app, and uploaded the `vivid-cinema-ios-simulator` artifact.
- Artifact ID: `13105770811`; it is a Simulator-only `.app` artifact with a seven-day retention window, not a signed IPA or physical-device installer.
- The generated iOS project currently exists only inside the CI job/artifact; the repository still does not track an `ios/` Xcode project.

## Native readiness gates before any physical-device beta

1. Obtain the real Firebase iOS app registration, `GoogleService-Info.plist`, Google iOS OAuth client ID, and reversed-client-ID URL scheme. The repository audit found none of these; do not invent or commit placeholders.
2. Replace the browser-only Google OAuth path with a supported native iOS sign-in flow and verified URL callback handling. The current auth module relies on Firebase popup/redirect APIs and has not been validated inside WKWebView.
3. Verify the Firebase project's App Check enforcement settings, then select and configure an iOS-compatible provider (DeviceCheck or App Attest). The current Firebase bootstrap uses reCAPTCHA Enterprise, which is a browser provider and is not a substitute for native attestation.
4. Validate Firebase auth persistence and Firestore/library sync after app termination and relaunch on a real iPhone.
5. Validate embedded playback, fullscreen/orientation, audio-session behaviour, external provider hand-off, subtitles and progress tracking on device. Cross-origin iframe players may not expose native controls or playback state.
6. Add and commit the reproducible native project/dependency setup only after reviewing the generated Xcode project and lockfile changes.

These are explicit release gates, not assumed-working features. The Simulator build passing does not close them.
