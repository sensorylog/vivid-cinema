import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://vivid-cinema.pages.dev",
  "https://vivid-cinema.web.app",
  "https://vivid-cinema.firebaseapp.com"
];

function setCors(req, res) {
  const configured = String(process.env.VIVID_ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
  const origin = req.headers.origin;
  if (!origin || !allowed.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  return true;
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

function sendError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    if (!setCors(req, res)) return sendError(res, 403, "origin-not-allowed", "This origin is not allowed.");
    return res.status(204).end();
  }
  if (req.method !== "POST") return sendError(res, 405, "method-not-allowed", "Use POST to delete an account.");
  if (!setCors(req, res)) return sendError(res, 403, "origin-not-allowed", "This origin is not allowed.");

  try {
    if (Number(req.headers["content-length"] || 0) > 4096) {
      return sendError(res, 413, "request-too-large", "The account deletion request is too large.");
    }
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return sendError(res, 401, "unauthenticated", "Sign in again to delete your account.");

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);
    const claims = await auth.verifyIdToken(match[1], true);
    const authTime = Number(claims.auth_time || 0) * 1000;
    if (!authTime || Date.now() - authTime > 5 * 60 * 1000) {
      return sendError(res, 403, "recent-sign-in-required", "Sign in again to confirm account deletion.");
    }

    const userReference = db.collection("users").doc(claims.uid);
    await db.recursiveDelete(userReference);
    await auth.deleteUser(claims.uid);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Vivid account deletion failed:", error);
    return sendError(res, 500, "account-deletion-unavailable", "Account deletion could not be completed. Contact Vivid support if the problem continues.");
  }
}
