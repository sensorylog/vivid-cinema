# Vivid Cinema custom verification email setup

The app uses a Firebase callable Cloud Function to generate the one-time email verification link with the Firebase Admin SDK and send a custom HTML email through Resend. The Admin SDK and Resend key are server-only; they are never included in browser code.

## One-time provider setup

1. Create a Resend account and verify a sending domain you control. Do not use an address/domain you do not own.
2. In Resend, create an API key with permission to send email.
3. Configure the Firebase Functions secrets from the repository root:

```sh
npx firebase-tools functions:secrets:set RESEND_API_KEY
npx firebase-tools functions:secrets:set VIVID_EMAIL_FROM
```

When prompted for `VIVID_EMAIL_FROM`, enter a verified sender such as `Vivid Cinema <verify@your-verified-domain.example>`, replacing the example with the real verified domain. Do not commit the key to Git or put it in frontend configuration.

4. Deploy the function after reviewing the target project and deployment plan:

```sh
npx firebase-tools deploy --only functions:sendVividVerificationEmail
```

Firebase may ask to enable billing/Cloud Functions services and to authorize secret access. Review the project and target before confirming.

## Email flow

- Signup creates the Firebase user, then calls the authenticated callable function.
- The function checks the signed-in UID and canonical Firebase user record, restricts requests to email/password accounts, and rate-limits sends to one per minute per UID.
- Firebase Admin SDK generates the verification link. Resend delivers the branded HTML and plain-text email.
- The browser verification page applies the action code and only shows success when Firebase confirms it.

The sender address must be verified by Resend. The existing Firebase email-template action URL / authorized-domain settings must also remain configured for Vivid's verification handler. Test with a real inbox after secrets are set and the function is deployed.
