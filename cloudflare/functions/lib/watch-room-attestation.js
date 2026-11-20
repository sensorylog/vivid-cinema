const encoder = new TextEncoder();
const SESSION_TTL_MS = 30 * 60 * 1000;

function encodeBase64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The browser session format is invalid.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sessionKey(secret, usages) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Watch Rooms session signing is not configured.");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

export async function createWatchRoomSession(uid, origin, secret, now = Date.now()) {
  if (typeof uid !== "string" || !uid || typeof origin !== "string" || !origin) {
    throw new Error("A signed-in user and trusted origin are required.");
  }
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    aud: "vivid-watch-rooms",
    sub: uid,
    origin,
    iat: issuedAt,
    exp: Math.floor((now + SESSION_TTL_MS) / 1000)
  };
  const payload = encodeBase64Url(JSON.stringify(claims));
  const key = await sessionKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return { token: payload + "." + encodeBase64Url(signature), expiresAt: claims.exp * 1000 };
}

export async function verifyWatchRoomSession(token, uid, origin, secret, now = Date.now()) {
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  if (typeof token !== "string" || token.length > 2048) {
    fail("room-session-invalid", "The browser session is invalid.");
  }
  const parts = token.split(".");
  if (parts.length !== 2) fail("room-session-invalid", "The browser session is invalid.");
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const key = await sessionKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[1]),
      encoder.encode(parts[0])
    );
    if (!valid) fail("room-session-invalid", "The browser session is invalid.");
  } catch (error) {
    if (error?.code) throw error;
    fail("room-session-invalid", "The browser session is invalid.");
  }

  const current = Math.floor(now / 1000);
  if (claims?.exp && claims.exp <= current) {
    fail("room-session-expired", "Browser verification expired. Please retry.");
  }
  if (
    claims?.aud !== "vivid-watch-rooms" ||
    claims?.sub !== uid ||
    claims?.origin !== origin ||
    !Number.isInteger(claims?.iat) ||
    !Number.isInteger(claims?.exp) ||
    claims.iat > current + 60 ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 31 * 60
  ) {
    fail("room-session-invalid", "The browser session is invalid.");
  }
  return claims;
}

export async function verifyTurnstileToken(token, secret, expectedHostname, remoteIp) {
  if (typeof token !== "string" || !token || token.length > 2048) {
    const error = new Error("A valid browser verification token is required.");
    error.code = "turnstile/invalid-token";
    throw error;
  }
  if (typeof secret !== "string" || !secret) {
    throw new Error("Cloudflare Turnstile is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(typeof remoteIp === "string" && remoteIp ? { remoteip: remoteIp } : {})
      }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      const error = new Error("Cloudflare could not verify this browser challenge.");
      error.code = "turnstile/verification-failed";
      throw error;
    }
    if (
      typeof expectedHostname !== "string" ||
      result.hostname?.toLowerCase() !== expectedHostname.toLowerCase() ||
      result.action !== "watch_rooms"
    ) {
      const error = new Error("Cloudflare browser verification did not match this Vivid site.");
      error.code = "turnstile/claims-mismatch";
      throw error;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    const failure = new Error("Cloudflare browser verification is temporarily unavailable.");
    failure.code = "turnstile/unavailable";
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}
