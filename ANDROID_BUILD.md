# Vivid Cinema Android build

The Android app bundles the site's static files locally with Capacitor. The existing Firebase Hosting website remains a separate deployment and is not changed by this build.

## First-time local setup

Requirements: Node.js 22, Android Studio, and an Android SDK.

```sh
npm install
npm run build:web
npx cap add android
npm run cap:sync
npx cap open android
```

In Android Studio, run the app on an emulator or connected phone. To build a debug APK from the command line:

```sh
cd android
./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

## GitHub Actions

Pushing to `android-capacitor-foundation` triggers the Android debug build workflow. If tests and the Android build pass, download the `vivid-cinema-debug-apk` artifact from that workflow run. It is a debug APK for testing, not a Play Store release.

## Current boundaries

- The app UI is bundled locally; Firebase, TMDB, and third-party playback providers still need network access.
- Email verification uses Firebase Auth's client SDK and the configured Firebase email action handler; no Vercel API or email Cloud Function is required by this client flow.
- Google sign-in, embedded playback/fullscreen, notification behavior, and Android back navigation still require device testing before release.
- Do not merge this branch into `main` until the build and app behavior have been reviewed.
