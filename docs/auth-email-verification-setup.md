# Vivid Cinema custom verification email setup without Firebase Cloud Functions

The website sends verification requests to a separate Vercel Node.js API. That API uses the Firebase Admin SDK to generate a one-time email verification link and Resend to deliver the branded HTML + plain-text message. This path does not require deploying Firebase Cloud Functions.

## 1. Create the Vercel API project

1. Import `sensorylog/vivid-cinema` into Vercel.
2. Name the Vercel project **`vivid-cinema-api`** so its URL is `https://vivid-cinema-api.vercel.app`. If Vercel gives the project a different domain, update `VERIFICATION_API_URL` in `scripts/auth.js` and the Vercel host in the Content Security Policy in `firebase.json` before deploying the website.
3. Keep the repository root as the project root. Vercel detects `api/send-verification.js` as a Node.js Function; no Firebase Functions deployment is needed for email verification.

## 2. Add server-side environment variables in Vercel

Open Project Settings → Environment Variables and add these to Production (and Preview if you intend to test there):

- `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete JSON key for a service account from Firebase Console → Project settings → Service accounts. Paste the full JSON as one environment-variable value. Never commit it to Git or put it in browser code.
- `RESEND_API_KEY`: the private API key from Resend.
- `VIVID_EMAIL_FROM`: a sender on a domain verified in Resend, e.g. `Vivid Cinema <verify@your-verified-domain.example>` (replace with your actual domain).
- `VIVID_ALLOWED_ORIGINS` (optional): comma-separated browser origins. The default is `https://vivid-cinema.web.app,https://vivid-cinema.firebaseapp.com`. Add any custom Vivid domain exactly, including the scheme.

Redeploy the Vercel project after adding environment variables.

## 3. Deploy and test

1. Deploy the Vercel project and confirm `https://vivid-cinema-api.vercel.app/api/send-verification` responds with HTTP 405 to a browser GET (it accepts authenticated POST only).
2. Deploy the updated static website to Firebase Hosting separately after reviewing the changes. This does not deploy Firebase Cloud Functions.
3. Test signup with a real inbox. The API requires a valid Firebase ID token, checks the canonical user record, limits sends to one per minute per UID, and only sends for email/password accounts.
4. Tap **Verify My Email** and confirm Vivid shows the success page. Also test an expired link, the resend flow, and the login flow.

## Security notes

- The Firebase service-account JSON and Resend API key must only exist in Vercel server-side environment variables.
- The endpoint ignores any email address supplied by the browser and uses the email associated with the verified Firebase ID token.
- The Firebase Admin SDK performs the authoritative user check and generates the one-time verification link.
- Firebase Admin accesses the existing Firebase Authentication and Firestore project; the email sender itself runs on Vercel rather than Firebase Cloud Functions.
- The success page is still a separate browser step. After verifying, users sign in normally; this does not silently create a session on a different browser/device.
