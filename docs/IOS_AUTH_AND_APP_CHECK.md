# iOS authentication and App Check integration notes

## Current repository state

- `scripts/auth.js` uses Firebase JavaScript SDK popup/redirect authentication for Google sign-in.
- `scripts/firebase.js` initializes App Check with `ReCaptchaEnterpriseProvider`, which is the web provider.
- Firestore and the library sync continue to use the Firebase JavaScript SDK.
- These browser paths have not yet been validated in the Capacitor iOS WKWebView and must not be described as native-ready.
- A repository configuration audit found only the web Firebase `init.json`; there is no tracked `GoogleService-Info.plist`, iOS Google OAuth client ID, or reversed-client-ID URL scheme. Those values must come from the Firebase/Google project owner and must never be guessed or fabricated.
- App Check enforcement cannot be established from the checked-in web configuration. It must be verified in the Firebase console before selecting or changing a native provider.

## Native Google sign-in candidate

The open-source `@capacitor-firebase/authentication` plugin has an 8.x line for Capacitor 8 and documents native Google sign-in on iOS. Its current project documentation describes URL callback handling in `AppDelegate.swift`, Google provider configuration, and the Swift Package Manager/CocoaPods integration options.

Important integration detail: the plugin's native Firebase Auth session is separate from the web JavaScript SDK session by default. Vivid's Firestore/library code uses the JS SDK, so native sign-in must securely bridge the returned Firebase ID token into the existing JS Auth instance (for example, with the Google credential flow) and then verify that auth-state restoration and library sync work after app relaunch. Do not just call the native plugin and assume Firestore will see the user.

Before adding the plugin, obtain the actual iOS Firebase app registration and Google OAuth configuration, then validate the plugin's exact Capacitor 8 compatibility and URL callback setup. Do not add placeholder plist files, fake client IDs, or a half-configured native sign-in path.

References:
- https://github.com/capawesome-team/capacitor-firebase/tree/main/packages/authentication
- https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md
- https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/firebase-js-sdk.md

## App Check gate

The existing reCAPTCHA Enterprise provider is browser-oriented. A native iOS build needs a native App Check provider if the Firebase project's enforcement policy requires one. Firebase documents DeviceCheck on Apple platforms and requires a DeviceCheck private key created in the Apple developer site before registering the app in Firebase App Check.

References:
- https://firebase.google.com/docs/app-check/ios/devicecheck-provider
- https://github.com/capawesome-team/capacitor-firebase/tree/main/packages/app-check

Do not disable App Check or silently bypass enforcement to make native login work. First inspect the project's actual enforcement settings, then choose a supported native provider. This may require Apple developer account access and credentials; stop before any paid enrolment, key creation, or external service purchase.

## Release gate

Native authentication is not complete until all of the following pass on a physical iPhone:
1. Google sign-in completes using the native provider flow.
2. The credential is bridged into the Firebase JS Auth instance.
3. Firestore and library sync see the same signed-in user.
4. Auth state survives force-quit and relaunch.
5. App Check obtains valid native tokens if enforcement is enabled.
6. Sign-out clears both native and JavaScript auth sessions.

Until then, keep the PWA authentication flow unchanged and available as the zero-cost public iPhone route.
