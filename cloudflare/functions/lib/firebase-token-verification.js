const encoder = new TextEncoder();
let authJwksCache;
let appCheckJwksCache;
let oauthCache;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}
function base64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return decodeBase64Url(body.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""));
}
function parseJwt(token) {
  if (typeof token !== "string") throw new Error("Token is missing.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token format is invalid.");
  return { parts, header: decodeJsonPart(parts[0]), claims: decodeJsonPart(parts[1]), signature: decodeBase64Url(parts[2]) };
}
async function getJwks(url, cache) {
  if (cache?.expiresAt > Date.now()) return cache.value;
  const response = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!response.ok) throw new Error("Unable to retrieve Firebase signing keys (" + response.status + ").");
  const value = await response.json();
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] || 21600);
  const next = { value, expiresAt: Date.now() + Math.min(maxAge, 21600) * 1000 };
  if (url.includes("appcheck")) appCheckJwksCache = next;
  else authJwksCache = next;
  return value;
}
async function verifyRs256(token, jwksUrl) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== "RS256" || parsed.header.typ !== "JWT" || typeof parsed.header.kid !== "string") throw new Error("Unsupported token signing algorithm or type.");
  const cache = jwksUrl.includes("appcheck") ? appCheckJwksCache : authJwksCache;
  const jwks = await getJwks(jwksUrl, cache);
  const jwk = jwks.keys?.find(key => key.kid === parsed.header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Firebase signing key was not found.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, parsed.signature, encoder.encode(parsed.parts[0] + "." + parsed.parts[1]));
  if (!valid) throw new Error("Token signature is invalid.");
  return parsed.claims;
}
async function serviceAccountAccessToken(serviceAccount) {
  if (oauthCache?.expiresAt > Date.now() + 60000) return oauthCache.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claims;
  const privateKey = await crypto.subtle.importKey("pkcs8", pemBytes(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoder.encode(unsigned));
  const assertion = unsigned + "." + base64Url(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Google service-account authorization failed (" + response.status + ").");
  oauthCache = { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
  return oauthCache.value;
}
function requireClaims(claims, projectId, issuer) {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer || claims.aud !== projectId || typeof claims.sub !== "string" ||
      !claims.sub || claims.sub.length > 128 || !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat) || claims.exp <= now || claims.iat > now + 300 ||
      claims.auth_time > now + 300) {
    throw new Error("Firebase ID token claims are invalid or expired.");
  }
}
export async function verifyFirebaseIdToken(idToken, projectId, serviceAccount) {
  let claims;
  try {
    claims = await verifyRs256(idToken, "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    requireClaims(claims, projectId, "https://securetoken.google.com/" + projectId);
  } catch (error) {
    error.code = /Unable to retrieve Firebase signing keys|Google service-account authorization failed/.test(error.message)
      ? "auth/internal-error" : "auth/invalid-id-token";
    throw error;
  }
  if (claims.firebase?.sign_in_provider === "anonymous") throw new Error("Anonymous Firebase accounts are not allowed.");
  const accessToken = await serviceAccountAccessToken(serviceAccount);
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/accounts:lookup", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [claims.sub] })
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error("Firebase user status/revocation lookup failed (" + response.status + ")."); error.code = "auth/internal-error"; throw error; }
  const user = result.users?.[0];
  if (!user || user.disabled) throw new Error("Firebase user is disabled or no longer exists.");
  if (Number(user.validSince || 0) > Number(claims.auth_time || 0)) throw new Error("Firebase ID token has been revoked.");
  return { ...claims, uid: claims.sub };
}

export async function createFirebaseCustomToken(uid, additionalClaims, serviceAccount) {
  if (typeof uid !== "string" || !uid || uid.length > 128 ||
      !serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("Firebase custom-token signing credentials are incomplete.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
    ...(additionalClaims && Object.keys(additionalClaims).length ? { claims: additionalClaims } : {})
  }));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return unsigned + "." + base64Url(signature);
}

export async function verifyAppCheckToken(token) {
  let claims;
  try {
    claims = await verifyRs256(token, "https://firebaseappcheck.googleapis.com/v1/jwks");
  } catch (error) {
    error.code = /Unable to retrieve Firebase signing keys|Google service-account authorization failed/.test(error.message)
      ? "appCheck/internal-error" : "appCheck/invalid-token";
    throw error;
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [];
  const projectAudience = audience.find(value => typeof value === "string" && /^projects\/[0-9]+$/.test(value));
  const projectNumber = projectAudience?.split("/")[1];
  const now = Math.floor(Date.now() / 1000);
  if (!projectNumber || claims.iss !== "https://firebaseappcheck.googleapis.com/" + projectNumber ||
      !Number.isFinite(claims.exp) || claims.exp <= now || claims.iat > now + 300 ||
      typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Firebase App Check token claims are invalid or expired.");
  }
  // Standard App Check tokens are signed, time-limited attestations. Verify
  // them locally; do not call the limited-use token consumption endpoint.
  return claims;
}


// Mirrors Firebase Admin SDK AppCheckTokenGenerator + exchangeToken. The
// service-account private key signs the short-lived custom token locally;
// Google exchanges it for a real Firebase App Check token. This avoids
// Firebase Cloud Functions and does not use reCAPTCHA Enterprise assessments.
export async function createFirebaseAppCheckToken(appId, projectId, serviceAccount, ttlMillis = 60 * 60 * 1000) {
  if (typeof appId !== "string" || !appId || typeof projectId !== "string" || !projectId) {
    throw new Error("Firebase App Check app/project configuration is missing.");
  }
  if (!Number.isFinite(ttlMillis) || ttlMillis < 30 * 60 * 1000 || ttlMillis > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("Firebase App Check token lifetime is outside the supported range.");
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("Firebase service-account signing credentials are incomplete.");
  }

  const now = Math.floor(Date.now() / 1000);
  const customTokenHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const customTokenClaims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    app_id: appId,
    aud: "https://firebaseappcheck.googleapis.com/google.firebase.appcheck.v1.TokenExchangeService",
    exp: now + 300,
    iat: now,
    ttl: (ttlMillis / 1000) + "s"
  }));
  const unsigned = customTokenHeader + "." + customTokenClaims;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoder.encode(unsigned));
  const customToken = unsigned + "." + base64Url(signature);
  const accessToken = await serviceAccountAccessToken(serviceAccount);
  const url = "https://firebaseappcheck.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) + "/apps/" + encodeURIComponent(appId) + ":exchangeCustomToken";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ customToken })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.token !== "string" || !result.token) {
    const error = new Error("Firebase App Check token exchange failed (" + response.status + ").");
    error.code = "app-check/token-exchange-failed";
    throw error;
  }
  const returnedTtl = typeof result.ttl === "string" && result.ttl.endsWith("s")
    ? Number(result.ttl.slice(0, -1)) * 1000
    : ttlMillis;
  if (!Number.isFinite(returnedTtl) || returnedTtl < 30 * 60 * 1000) {
    throw new Error("Firebase returned an invalid App Check token lifetime.");
  }
  return { token: result.token, ttlMillis: returnedTtl };
}
