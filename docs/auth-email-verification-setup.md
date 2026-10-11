# Email verification flow setup

The repository now includes a Vivid-branded verification landing page that applies Firebase's one-time email action code and then offers a clear sign-in action.

## Required Firebase Console configuration

This part cannot be changed from repository code alone.

1. Open Firebase Console → Authentication → Templates → Email address verification.
2. Customize the action URL to the deployed Vivid page, for example `https://YOUR_VIVID_HOST/verify-email.html`. Use the actual public hosting domain for this project.
3. Save the template and confirm that the domain is authorized in Authentication settings.
4. Send a fresh verification email and test the link on desktop and mobile.

Firebase will append parameters such as `mode=verifyEmail` and `oobCode` to the configured action URL. The page calls Firebase `applyActionCode`; it only displays success after Firebase accepts that one-time code.

## Email appearance limitation

The Firebase client SDK sends Firebase-managed email templates. The code change does not replace Firebase's email delivery or grant full control over its HTML. Update the template's wording and sender details in Firebase Console. If the project needs a fully custom HTML email with a branded CTA button and custom sender domain, use a trusted server-side email service with Firebase Admin SDK-generated verification links; never generate or send Admin SDK action links from browser code.

## After verification

The success page provides a sign-in button rather than silently creating a new session. The signup flow signs out unverified users, and the verification email may be opened in a different browser or device, where the original password/session is not available. The user can then sign in normally with their verified email and password.
