import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const VIVID_EMAIL_FROM = defineSecret("VIVID_EMAIL_FROM");
const VERIFY_CONTINUE_URL = "https://vivid-cinema.web.app/verify-email.html";
const MIN_RESEND_INTERVAL_MS = 60 * 1000;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function verificationEmailHtml({ displayName, verificationLink }) {
  const name = escapeHtml(displayName || "there");
  const link = escapeHtml(verificationLink);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="dark"></head>',
    '<body style="margin:0;padding:0;background:#08090b;color:#f5f7fa;font-family:Arial,Helvetica,sans-serif">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">Verify your email to finish setting up Vivid Cinema.</div>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08090b;padding:36px 12px"><tr><td align="center">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111318;border:1px solid #262a33;border-radius:20px;overflow:hidden">',
    '<tr><td style="padding:30px 32px 12px;text-align:center"><div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#aeb5c2;font-weight:700">VIVID CINEMA</div>',
    '<div style="height:3px;width:54px;background:#f5f7fa;margin:18px auto 0;border-radius:4px"></div></td></tr>',
    '<tr><td style="padding:22px 32px 36px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 18px;color:#fff">One quick step, ' + name + '.</h1>',
    '<p style="font-size:16px;line-height:1.7;color:#c4c9d2;margin:0 0 14px">Welcome to Vivid Cinema. Verify your email address to finish setting up your account.</p>',
    '<p style="font-size:16px;line-height:1.7;color:#c4c9d2;margin:0 0 26px">Tap the button below — we’ll open a secure page to confirm your email.</p>',
    '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px"><tr><td align="center" bgcolor="#f5f7fa" style="border-radius:10px">',
    '<a href="' + link + '" target="_blank" rel="noopener" style="display:inline-block;padding:15px 26px;color:#08090b;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px">Verify My Email</a>',
    '</td></tr></table><p style="font-size:13px;line-height:1.6;color:#969eaa;margin:0 0 8px">If the button doesn’t open, copy this link into your browser:</p>',
    '<p style="font-size:12px;line-height:1.6;word-break:break-all;margin:0 0 24px"><a href="' + link + '" style="color:#cdd3dd">' + link + '</a></p>',
    '<div style="height:1px;background:#2b2f38;margin:24px 0"></div><p style="font-size:13px;line-height:1.6;color:#969eaa;margin:0">If you didn’t create a Vivid Cinema account, you can safely ignore this email.</p>',
    '</td></tr></table><p style="font-size:11px;line-height:1.6;color:#777f8c;margin:18px 0 0">Vivid Cinema · Discover your next favourite</p>',
    '</td></tr></table></body></html>'
  ].join("");
}

function verificationEmailText({ displayName, verificationLink }) {
  return "Hi " + (displayName || "there") + ",\n\n" +
    "Welcome to Vivid Cinema. Verify your email address to finish setting up your account:\n\n" +
    verificationLink + "\n\n" +
    "If you didn't create a Vivid Cinema account, you can ignore this email.\n\n" +
    "— Vivid Cinema Team";
}

export const sendVividVerificationEmail = onCall({
  region: "us-central1",
  maxInstances: 10,
  secrets: [RESEND_API_KEY, VIVID_EMAIL_FROM]
}, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to request a verification email.");
  }
  if (request.auth.token.email_verified === true) {
    return { alreadyVerified: true };
  }
  if (request.auth.token.firebase?.sign_in_provider !== "password") {
    throw new HttpsError("failed-precondition", "Email verification is only available for email-and-password accounts.");
  }

  const auth = getAuth();
  const user = await auth.getUser(request.auth.uid);
  if (!user.email) {
    throw new HttpsError("failed-precondition", "This account has no email address to verify.");
  }
  if (user.emailVerified) return { alreadyVerified: true };

  const db = getFirestore();
  const rateRef = db.collection("emailVerificationRateLimits").doc(user.uid);
  const now = Date.now();
  const rate = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(rateRef);
    const lastSentAt = snapshot.exists ? Number(snapshot.data().lastSentAtMs || 0) : 0;
    if (now - lastSentAt < MIN_RESEND_INTERVAL_MS) return { allowed: false };
    transaction.set(rateRef, { lastSentAtMs: now, updatedAt: Timestamp.now() }, { merge: true });
    return { allowed: true };
  });
  if (!rate.allowed) {
    throw new HttpsError("resource-exhausted", "Please wait a minute before requesting another verification email.");
  }

  try {
    const verificationLink = await auth.generateEmailVerificationLink(user.email, {
      url: VERIFY_CONTINUE_URL,
      handleCodeInApp: false
    });
    const from = VIVID_EMAIL_FROM.value().trim();
    const apiKey = RESEND_API_KEY.value().trim();
    if (!from || !apiKey) throw new Error("Email provider secrets are not configured.");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: "Verify your email · Vivid Cinema",
        html: verificationEmailHtml({ displayName: user.displayName, verificationLink }),
        text: verificationEmailText({ displayName: user.displayName, verificationLink })
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      logger.error("Vivid verification email provider rejected request", { status: response.status, detail });
      throw new Error("Email provider rejected the verification email.");
    }
    logger.info("Vivid verification email sent", { uid: user.uid });
    return { sent: true };
  } catch (error) {
    logger.error("Could not send Vivid verification email", { uid: user.uid, message: String(error?.message || error) });
    throw new HttpsError("internal", "We couldn't send the verification email right now. Please try again in a minute.");
  }
});
