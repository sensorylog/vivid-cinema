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

The legacy **Android APK Build** workflow is retained but disabled; it previously published Android assets into Windows desktop releases and is no longer the release path. Direct Android releases are built by **Vivid Cinema Android Direct Release**, a manual workflow that creates independent `android-v*` releases, verifies the APK, and runs an Android 15 emulator launch/resume smoke test before publishing. Pull requests still exercise Android source contracts through the main quality suite. Direct APKs are development-signed for sideload distribution and are not Google Play releases.

## Android experience and compatibility

- Android uses five primary bottom-navigation destinations (Home, Browse, For You, Library, More). Live, News, Search and Watch Rooms are in the accessible More menu, avoiding seven compressed navigation targets on small screens.
- The app bundles its shell locally. Catalogue, account, recommendations, Watch Rooms and third-party playback still depend on their respective network services.
- Playback progress is saved when the document is hidden or page-hidden. Watch Room realtime subscriptions reconnect when the app returns to the foreground. The updater rechecks when Android returns the app to the foreground, subject to its cache cooldown.
- Android uses the same Cloudflare Turnstile-backed verification flow as the website. Capacitor serves bundled assets under `https://android.vivid-cinema.pages.dev`; the app sends protected API calls to the canonical Pages origin, `https://vivid-cinema.pages.dev`, and the Cloudflare endpoints allow the dedicated app subdomain. Add `android.vivid-cinema.pages.dev` to Firebase Authentication's authorized domains if OAuth or redirect-based sign-in is enabled. The Turnstile widget must allow the `vivid-cinema.pages.dev` hostname (Cloudflare hostname entries include subdomains). Android's WebView keeps DOM storage and cookies enabled for the challenge. The packaged WebView has its own `android.vivid-cinema.pages.dev` origin, and protected API requests are sent to the real `https://vivid-cinema.pages.dev` Cloudflare Pages endpoints. The Cloudflare Pages API accepts the dedicated subdomain and validates the Turnstile hostname before issuing the website's existing short-lived verification token. No native Firebase Android app registration or Play Integrity provider is required by this architecture. Turnstile compatibility and Watch Rooms must still pass Android emulator and physical-device tests before release.
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

Generate and back up the keystore securely on a trusted machine. Base64-encode the existing keystore file for the secret; never commit the keystore or secrets, paste passwords or keystore bytes into chat, or print them in workflow logs. Keep encrypted offline backups. Keep the upload key secure and consistent unless you deliberately rotate it through Play Console. Google Play App Signing uses Google's app-signing key for APKs delivered to Play users; the upload key is used to authenticate AAB uploads.

Once the four secrets are configured, run **Actions → Android Play Store signed release → Run workflow** and leave `publish_to_github_release` enabled. This workflow builds the **Play Store distribution**: it omits the GitHub APK updater plugin and `REQUEST_INSTALL_PACKAGES` permission, because Play-distributed installs must receive updates through Google Play rather than sideloading.

The 90-day workflow artifact contains a signed APK for controlled QA and a signed Android App Bundle (AAB). Only the AAB and a separate `Vivid-Cinema-Android-Play-build-<build>.json` metadata file are attached to the matching GitHub release for deliberate Play Console upload. The Play workflow never overwrites the stable `Vivid-Cinema-Android.apk` or direct-distribution build metadata, so existing sideloaded installs cannot be offered an APK signed with a different key. Google Play manages updates for Play installs. This workflow does not publish to Google Play automatically.

The direct/sideload channel remains separate: the **Android APK Build** workflow publishes its development-signed APK and uses the GitHub updater. That channel is for testing and early distribution, not a production Play Store release. Do not mix the direct development signing key with the private Play upload key.

The workflow intentionally fails early when signing secrets are missing. It uses the shared navigation and fullscreen plugins and icon resources, omits the direct-distribution updater, then applies the private production signing configuration. Production builds use a separate higher build-number range. A Play Store listing, production upload-key secrets, policy review, and physical-device acceptance testing are still required before a public Play rollout. Native Firebase Android registration and Play Integrity are not prerequisites for the current Cloudflare Turnstile-backed Watch Rooms flow. No Firebase Cloud Functions, Blaze plan, or cloud backend is required for APK signing.


### Moving from the current debug APK to the first signed release

Android treats a differently signed APK as a different publisher. The existing CI APK is debug-signed, so the first production-signed APK may not install as an in-place update over a previously installed debug APK. Back up anything important first; uninstalling the debug build can clear app-local data. After the first signed release is installed, keep using the same production keystore for every subsequent update.


## Independent Android direct releases (Android v1)

Android direct-distribution releases now have their own version line and GitHub release tags. The first clean Android release starts at **1.0.0** and is published as `android-v1.0.0`. Future Android updates use `android-v1.0.1`, `android-v1.0.2`, and so on. Windows releases continue to use `v1.0.47`, `v1.0.48`, etc. The Android updater never reads the Windows `latest.yml`, Windows installer assets, or the GitHub `/releases/latest` endpoint.

To build and publish an Android direct release, run **Actions → Vivid Cinema Android Direct Release → Run workflow**. Set `android_version` to `1.0.0` for the first v1 release; increment it for each later Android APK. For the first migration release, leave `legacy_bridge_tag` set to `v1.0.47`. That one-time bridge attaches the exact same Android APK to the current Windows release so already-installed older apps—which contain the previous updater and only know how to query the GitHub latest release—can discover and install Android v1. Once users have installed Android v1, their updater checks only the dedicated `android-v*` release channel. Leave `legacy_bridge_tag` empty for subsequent Android releases.

The workflow builds and verifies the APK, runs the Android emulator launch/resume smoke test, and publishes:
- `Vivid-Cinema-Android.apk`
- `Vivid-Cinema-Android-build-<build>.json`
- `Vivid-Cinema-Android-SHA256.txt`

The release is marked as not-latest so it cannot replace the Windows desktop release as GitHub's global latest release. The downloads page also queries the independent Android release channel and resolves the APK separately from Windows downloads.

### In-app update behavior

The installed Android app checks the published Android release list for the highest stable `android-vMAJOR.MINOR.PATCH` release. Windows tags and Windows assets are ignored. If the Android build number is newer than the installed build, the app shows **Update Vivid Cinema** with **Download & Install** and **Later** actions. Choosing Download & Install uses Android DownloadManager, persists the download ID across app restarts, then opens Android's system package installer. Android may ask the user to allow installs from Vivid Cinema and confirm the update. Successful checks are cached for fifteen minutes; failed checks retry after five minutes; dismissing a notice suppresses it only for that build.

### Android version identity and compatibility

The Android display version starts fresh at **1.0.0**, independent of the root package.json and Windows desktop version. The Android `versionCode` deliberately remains monotonic and starts in a higher range than the historical direct APKs. Android will reject an in-place update if the new versionCode is lower than the installed one, even when the displayed version name is reset.

The application ID remains `com.vividcinema.app`, and the direct APK workflow restores the established Vivid Cinema development signing identity from the historical release asset. Both are required for existing direct APK installs to update in place and retain app data. The development keystore is publicly available in an old release and is strictly for this sideload/testing channel; never use it for production or Google Play. If an older installation was signed with a different temporary key, Android may reject an in-place update. In that case, back up important data before uninstalling and installing Android v1 manually.

The direct Android release workflow is separate from the paused Play Store signed-release workflow. Play-distributed installs must continue receiving updates through Google Play; the GitHub APK updater is not used for Play builds. The direct APK is not a Play Store publication.
