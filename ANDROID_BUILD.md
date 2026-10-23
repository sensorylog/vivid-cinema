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


## Signed Android release APK

The debug workflow is for testing only. To build a production-signed APK, first configure these **repository Actions secrets** under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded Java keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing key alias.
- `ANDROID_KEY_PASSWORD`: key password.

Generate and back up the keystore securely on a trusted machine. Base64-encode the existing keystore file for the secret; never commit the keystore or secrets, paste passwords or keystore bytes into chat, or print them in workflow logs. Keep encrypted offline backups. **Every future APK update must use the same signing key** or Android will reject it as an update to the installed app.

Once the four secrets are configured, run **Actions → Android signed release APK → Run workflow**. The workflow creates and verifies a signed release APK and stores it as a 90-day artifact. The optional `publish_to_github_release` input uploads it to the existing matching `v<package version>` GitHub release; it does not publish to Google Play.

The workflow intentionally fails early when signing secrets are missing. No Firebase Cloud Functions, Blaze plan, or cloud backend is required for APK signing.


### Moving from the current debug APK to the first signed release

Android treats a differently signed APK as a different publisher. The existing CI APK is debug-signed, so the first production-signed APK may not install as an in-place update over a previously installed debug APK. Back up anything important first; uninstalling the debug build can clear app-local data. After the first signed release is installed, keep using the same production keystore for every subsequent update.
