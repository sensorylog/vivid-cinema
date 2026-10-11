import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const VERIFY_CONTINUE_URL = "https://vivid-cinema.web.app/verify-email.html";
const MIN_RESEND_INTERVAL_MS = 60_000;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://vivid-cinema.web.app",
  "https://vivid-cinema.firebaseapp.com"
];

function allowedOrigins() {
  const configured = String(process.env.VIVID_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins().has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  return true;
}

function sendError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function getAdminApp() {
  if (getApps().length) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const serviceAccount = JSON.parse(raw);
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service account JSON is incomplete.");
  }
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

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
    '<p style="font-size:16px;line-height:1.7;color:#c4c9d2;margin:0 0 26px">Tap the button below to confirm your email securely.</p>',
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!setCors(req, res)) return sendError(res, 403, "vivid/origin-not-allowed", "This origin is not allowed.");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "vivid/method-not-allowed", "Use POST for this endpoint.");
  }

  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return sendError(res, 401, "vivid/missing-token", "Sign in and try again.");

  try {
    const app = getAdminApp();
    const adminAuth = getAuth(app);
    const decoded = await adminAuth.verifyIdToken(match[1], true);
    if (decoded.firebase?.sign_in_provider !== "password") {
      return sendError(res, 403, "vivid/password-account-required", "Email verification is only available for email-and-password accounts.");
    }

    const user = await adminAuth.getUser(decoded.uid);
    if (!user.email) return sendError(res, 400, "vivid/email-missing", "This account has no email address.");
    if (user.emailVerified) return res.status(200).json({ ok: true, alreadyVerified: true });

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.VIVID_EMAIL_FROM?.trim();
    if (!apiKey || !from) throw new Error("Resend email settings are not configured.");

    const db = getFirestore(app);
    const rateRef = db.collection("emailVerificationRateLimits").doc(user.uid);
    const now = Date.now();
    const allowed = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(rateRef);
      const lastSentAt = snapshot.exists ? Number(snapshot.data().lastSentAtMs || 0) : 0;
      if (now - lastSentAt < MIN_RESEND_INTERVAL_MS) return false;
      transaction.set(rateRef, { lastSentAtMs: now, updatedAt: Timestamp.now() }, { merge: true });
      return true;
    });
    if (!allowed) {
      return sendError(res, 429, "vivid/rate-limited", "Please wait a minute before requesting another verification email.");
    }

    const verificationLink = await adminAuth.generateEmailVerificationLink(user.email, {
      url: VERIFY_CONTINUE_URL,
      handleCodeInApp: false
    });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: "Verify your email · Vivid Cinema",
        html: verificationEmailHtml({ displayName: user.displayName, verificationLink }),
        text: verificationEmailText({ displayName: user.displayName, verificationLink })
      }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      console.error("Vivid verification email provider rejected request", { status: response.status });
      return sendError(res, 502, "vivid/email-send-failed", "We couldn't send the verification email right now. Please try again in a minute.");
    }
    return res.status(200).json({ ok: true, sent: true });
  } catch (error) {
    console.error("Vivid verification endpoint failed:", String(error?.message || error));
    if (error?.code === "auth/id-token-expired" || error?.code === "auth/argument-error" || error?.code === "auth/invalid-id-token") {
      return sendError(res, 401, "vivid/invalid-token", "Your sign-in has expired. Please try again.");
    }
    return sendError(res, 500, "vivid/email-service-error", "We couldn't send the verification email right now. Please try again in a minute.");
  }
}
