# Vivid Cinema Android build

The Android app bundles the site's static files locally with Capacitor. The live Cloudflare Pages website is deployed separately; building Android does not deploy or change the live website.

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

Every pull request runs the **Android APK Build** workflow because the APK bundles the shared application, not just a small Android-only folder. The workflow runs Android-specific regression tests, generates and signs the Capacitor project, verifies the package and launcher icon, then installs and launches the APK in an Android 15 emulator. The emulator smoke test backgrounds and resumes the app and checks for a fatal process crash. A successful PR run uploads the `vivid-cinema-android-apk` artifact; it does not publish a preview APK. A push to `main` builds and publishes the stable `Vivid-Cinema-Android.apk` asset to the matching GitHub release. You can also run the workflow manually from GitHub Actions. The current development-signed APK is for testing and early distribution, not a Play Store release.

## Android experience and compatibility

- Android uses five primary bottom-navigation destinations (Home, Browse, For You, Library, More). Live, News, Search and Watch Rooms are in the accessible More menu, avoiding seven compressed navigation targets on small screens.
- The app bundles its shell locally. Catalogue, account, recommendations, Watch Rooms and third-party playback still depend on their respective network services.
- Playback progress is saved when the document is hidden or page-hidden. Watch Room realtime subscriptions reconnect when the app returns to the foreground. The updater rechecks when Android returns the app to the foreground, subject to its cache cooldown.
- Watch Rooms are not yet available in the native Android build: the trusted backend requires Firebase App Check, while this project has no registered Android Firebase app or Play Integrity provider configured. The client now reports this explicitly; do not bypass backend App Check to make the feature appear to work.
- Background push is currently implemented through the browser Web Push API. A native Firebase Cloud Messaging integration is not included; the feature is available only when the runtime exposes the required service-worker, PushManager and Notification APIs.
- Google sign-in and third-party streaming-provider behavior must be verified on physical Android devices. Provider iframe fullscreen behavior varies by provider and Android WebView version.
- The CI emulator test is a launch/lifecycle smoke test, not a substitute for testing account sign-in, microphone permission prompts, fullscreen playback, external providers, low-memory pressure, rotation, or interrupted downloads on real devices.

## Native Android source

The Capacitor Android project is generated during CI, but Vivid's native code is maintained as normal Java source under `native/android/`:

- `VividUpdaterPlugin.java` — GitHub APK download, install permission and persisted download recovery.
- `VividNavigationPlugin.java` — Android hardware Back bridge.
- `VividWebChromeClient.java` — fullscreen custom-view support while retaining Capacitor's permission, dialog and file-picker behavior.

`automation/configure-android-native-project.mjs` copies these source files into the generated Android project and applies app version and manifest configuration.

## Current boundaries

- The app UI is bundled locally; Firebase, TMDB, and third-party playback providers still need network access.
- Email verification uses Firebase Auth's client SDK and the configured Firebase email action handler; no Vercel API or email Cloud Function is required by this client flow.
- Google sign-in, embedded playback/fullscreen, notification behavior, in-app APK updates, and Android back navigation still require real-device testing before a production release.


## Signed Android release APK

The debug workflow is for testing only. To build a production-signed APK, first configure these **repository Actions secrets** under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded Java keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing key alias.
- `ANDROID_KEY_PASSWORD`: key password.

Generate and back up the keystore securely on a trusted machine. Base64-encode the existing keystore file for the secret; never commit the keystore or secrets, paste passwords or keystore bytes into chat, or print them in workflow logs. Keep encrypted offline backups. **Every future APK update must use the same signing key** or Android will reject it as an update to the installed app.

Once the four secrets are configured, create the repository Actions variable `ANDROID_PRODUCTION_SIGNING_ENABLED=true` before switching the public APK asset to the production signing identity. This prevents the automatic debug workflow from replacing the signed APK with a differently signed development build on a later push. The debug workflow will still build and upload its CI artifact, but it will stop publishing the debug APK to releases. Then run **Actions → Android Play Store signed release → Run workflow** and leave `publish_to_github_release` enabled to publish the APK and matching build metadata to the `v<package version>` GitHub release. This workflow is manual-only so ordinary GitHub releases continue using the direct-distribution debug APK path while production signing is deferred. It explicitly builds the **Play Store distribution**: the generated app omits the GitHub APK updater plugin and `REQUEST_INSTALL_PACKAGES` permission, because Play-distributed installs must receive updates through Google Play rather than sideloading. It builds and verifies both a signed APK and a signed Android App Bundle (AAB). The 90-day workflow artifact contains both files; the APK is attached to the matching GitHub release for controlled testing, while the AAB is the artifact to upload deliberately through Play Console. Google Play manages updates for Play installs. This workflow does not publish to Google Play automatically.

The workflow intentionally fails early when signing secrets are missing. It uses the shared navigation and fullscreen plugins and icon resources, omits the direct-distribution updater, then applies the private production signing configuration. Production builds use a separate higher build-number range. A Play Store listing, Firebase Android app registration, Play Integrity/App Check configuration, policy review, and physical-device acceptance testing are still required before a public Play rollout. No Firebase Cloud Functions, Blaze plan, or cloud backend is required for APK signing.


### Moving from the current debug APK to the first signed release

Android treats a differently signed APK as a different publisher. The existing CI APK is debug-signed, so the first production-signed APK may not install as an in-place update over a previously installed debug APK. Back up anything important first; uninstalling the debug build can clear app-local data. After the first signed release is installed, keep using the same production keystore for every subsequent update.


## Automatic Android updates while production signing is deferred

The current no-production-signing path uses an Android APK signed with a development-only key. The **Android APK Build** workflow builds it on pushes to `main` and on published GitHub releases, then publishes it as `Vivid-Cinema-Android.apk` alongside a numbered `Vivid-Cinema-Android-build-<build>.json` metadata asset. The downloads page detects the stable APK asset automatically; the installed app uses the metadata file to check for a newer build.

The installed app name is simply **Vivid Cinema** and its launcher icon uses the shared `icons/vivid-icon-180.png` source. The bundled app checks the latest GitHub release metadata for a newer Android build. Successful checks are cached for six hours and failed checks for fifteen minutes so navigating between bundled pages does not repeatedly consume the unauthenticated GitHub API rate limit. Dismissing a notice is remembered until a newer build is published. When one is available, it displays an **Update Vivid Cinema** notice. Android download IDs are persisted and reconciled after app resume or process restart, so a completed update is not lost if Android kills the app during the download. The direct-distribution build requests Android's per-app unknown-source install permission only after the user explicitly chooses **Download & Install**; if permission is missing, it opens the relevant Settings page and asks the user to retry. Microphone and audio-routing permissions are deliberately omitted from current Android builds because native Watch Rooms is still blocked on Play Integrity/App Check setup. They can be enabled explicitly for a verified voice-capable build; ordinary browsing and playback do not need microphone access. Tapping **Download & Install** uses Android's download manager and opens the system package installer; Android may ask the user to allow Vivid Cinema to install apps from this source and to confirm installation.

To make in-place debug updates possible without manual signing setup, the workflow reuses a dedicated development-only keystore stored as a GitHub release asset. This is not a production signing key and must never be promoted as one. The development-only keystore is intentionally retained as a public release asset so CI can reuse the same signing identity for in-place updates. Anyone can access it, so it must never be used for a production or Play Store release. Production release signing should use a separate private keystore when ready.

**One-time transition note:** APKs produced by older workflow runs used each runner's temporary debug key. If one of those builds is already installed, Android may reject the first APK produced by the stable-key workflow as an update. Uninstall that old build once, then install the new APK. After that, future builds from this workflow reuse the same debug key and can update in place. Uninstalling may clear app-local data, so back up anything important first.

This workflow does not require Firebase Cloud Functions, a Blaze plan, or manually configured Android signing secrets. It does not publish to Google Play.
