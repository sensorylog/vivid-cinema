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

Pushing to `android-capacitor-foundation` triggers the Android APK Build workflow. If tests and the Android build pass, download the `vivid-cinema-android-apk` artifact from that workflow run. The current development-signed APK is for early distribution, not a Play Store release.

## Current boundaries

- The app UI is bundled locally; Firebase, TMDB, and third-party playback providers still need network access.
- Email verification uses Firebase Auth's client SDK and the configured Firebase email action handler; no Vercel API or email Cloud Function is required by this client flow.
- Google sign-in, embedded playback/fullscreen, notification behavior, and Android back navigation still require device testing before release.
- Do not merge this branch into `main` until the build and app behavior have been reviewed.


## Signed Android release APK

The debug workflow is for testing only. To build a production-signed APK, first configure these **repository Actions secrets** under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded Java keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing key alias.
- `ANDROID_KEY_PASSWORD`: key password.

Generate and back up the keystore securely on a trusted machine. Base64-encode the existing keystore file for the secret; never commit the keystore or secrets, paste passwords or keystore bytes into chat, or print them in workflow logs. Keep encrypted offline backups. **Every future APK update must use the same signing key** or Android will reject it as an update to the installed app.

Once the four secrets are configured, run **Actions → Android signed release APK → Run workflow** and leave `publish_to_github_release` enabled to publish the APK to the matching `v<package version>` GitHub release. This workflow is manual-only so ordinary GitHub releases continue using the debug APK path while production signing is deferred. When run, it verifies the signature, stores a 90-day workflow artifact, and attaches the APK as the stable asset name `Vivid-Cinema-Android.apk`. The latest signed APK download URL is https://github.com/sensorylog/vivid-cinema/releases/latest/download/Vivid-Cinema-Android.apk. This does not publish to Google Play.

The workflow intentionally fails early when signing secrets are missing. No Firebase Cloud Functions, Blaze plan, or cloud backend is required for APK signing.


### Moving from the current debug APK to the first signed release

Android treats a differently signed APK as a different publisher. The existing CI APK is debug-signed, so the first production-signed APK may not install as an in-place update over a previously installed debug APK. Back up anything important first; uninstalling the debug build can clear app-local data. After the first signed release is installed, keep using the same production keystore for every subsequent update.


## Automatic Android updates while production signing is deferred

The current no-production-signing path uses an Android APK signed with a development-only key. The **Android APK Build** workflow builds it on pushes to `main` and on published GitHub releases, then publishes it as `Vivid-Cinema-Android.apk` alongside a numbered `Vivid-Cinema-Android-build-<build>.json` metadata asset. The downloads page detects the stable APK asset automatically; the installed app uses the metadata file to check for a newer build.

The installed app name is simply **Vivid Cinema** and its launcher icon uses the shared `icons/vivid-icon-180.png` source. The bundled app checks the latest GitHub release metadata for a newer Android build. When one is available, it displays an **Update Vivid Cinema** notice. Tapping **Download & Install** uses Android's download manager and opens the system package installer; Android may ask the user to allow Vivid Cinema to install apps from this source and to confirm installation.

To make in-place debug updates possible without manual signing setup, the workflow reuses a dedicated development-only keystore stored as a GitHub release asset. This is not a production signing key and must never be promoted as one. The key is public because it is distributed with this development build; use this path only for testing and early distribution. Production release signing should use a separate private keystore when ready.

**One-time transition note:** APKs produced by older workflow runs used each runner's temporary debug key. If one of those builds is already installed, Android may reject the first APK produced by the stable-key workflow as an update. Uninstall that old build once, then install the new APK. After that, future builds from this workflow reuse the same debug key and can update in place. Uninstalling may clear app-local data, so back up anything important first.

This workflow does not require Firebase Cloud Functions, a Blaze plan, or manually configured Android signing secrets. It does not publish to Google Play.
