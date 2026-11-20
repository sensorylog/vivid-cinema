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
export async function verifyAndConsumeAppCheckToken(token, serviceAccount) {
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
  const accessToken = await serviceAccountAccessToken(serviceAccount);
  const response = await fetch("https://firebaseappcheck.googleapis.com/v1beta/projects/" + projectNumber + ":verifyAppCheckToken", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ appCheckToken: token })
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error("Firebase App Check verification/consumption failed (" + response.status + ")."); error.code = "appCheck/internal-error"; throw error; }
  return { ...claims, alreadyConsumed: result.alreadyConsumed === true };
}
