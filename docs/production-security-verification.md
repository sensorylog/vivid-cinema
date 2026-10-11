# Production security verification

This checklist supplements the automated checks. Emulator tests do not prove that the deployed Firebase project is using the reviewed rules or that Hosting is returning the expected headers.

## 1. Run automated checks

From the repository root:

```sh
npm install
npm test
npm run test:rules
```

The GitHub Actions **Quality checks** workflow runs these checks on pushes and pull requests.

## 2. Verify Firestore rules in the intended Firebase project

1. Confirm the Firebase project ID before deployment.
2. Review the diff for `firestore.rules`.
3. Authenticate with the Firebase CLI using an account authorized to deploy rules.
4. Deploy only the rules after review:

```sh
npx firebase-tools deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

5. In Firebase Console, confirm the published rules match the reviewed file.
6. Verify that an authenticated user can access their own profile/library, a different user's private data is denied, malformed library writes are rejected, and public community content remains subject to the intended publication rules.

Do not use production user data for negative tests. Use the emulator or a dedicated test project.

## 3. Verify Hosting security headers

After deploying Hosting, inspect a public HTML response:

```sh
curl -sSI https://YOUR_HOSTING_DOMAIN/home.html
```

Check for the expected Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and X-Frame-Options headers. Confirm the CSP allows only the documented application and provider origins.

## 4. Browser/device release gate

On the deployed site, verify:
- login/logout and cross-user Firestore denial;
- movie and TV playback with VidAPI, VidSrc, VidLink, VidPlus, and VidKing where those providers have a playable source;
- manual server switching and fallback after a provider error;
- iOS Safari and Chromium mobile behavior;
- service-worker upgrade from an older cached release, offline navigation, and missing optional assets;
- keyboard controls, reduced motion, and fullscreen behavior.

External providers can be unavailable or have no source for a specific title. A generated embed URL and an iframe load event are not proof of playable media. Record the tested title, provider, browser, date, and observed result before marking the production gate complete.
