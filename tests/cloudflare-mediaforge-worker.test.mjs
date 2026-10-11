import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker, { verifyFirebaseIdToken } from "../cloudflare/src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function encodeJson(value) {
  return b64url(Buffer.from(JSON.stringify(value)));
}

const now = Math.floor(Date.now() / 1000);
const pair = await crypto.subtle.generateKey({
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256"
}, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key", alg: "RS256" };

async function makeToken(overrides = {}) {
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "test-key" });
  const claims = encodeJson({
    aud: "vivid-cinema",
    iss: "https://securetoken.google.com/vivid-cinema",
    sub: "user_123",
    iat: now,
    exp: now + 3600,
    auth_time: now,
    ...overrides
  });
  const input = header + "." + claims;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
  return input + "." + b64url(signature);
}

function keyFetch() {
  return async (url, options = {}) => {
    assert.equal(url, "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
    });
  };
}

const env = {
  FIREBASE_PROJECT_ID: "vivid-cinema",
  ALLOWED_ORIGIN: "https://vivid-cinema.web.app",
  MEDIA_BUCKET: {}
};

test("Firebase ID token verifier accepts a valid signature and rejects wrong audience", async () => {
  const valid = await makeToken();
  const identity = await verifyFirebaseIdToken(valid, "vivid-cinema", keyFetch(), now);
  assert.equal(identity.uid, "user_123");
  assert.equal(await verifyFirebaseIdToken(valid, "another-project", keyFetch(), now), null);
});

test("Firebase ID token verifier rejects expired and malformed tokens", async () => {
  const expired = await makeToken({ exp: now - 1 });
  assert.equal(await verifyFirebaseIdToken(expired, "vivid-cinema", keyFetch(), now), null);
  assert.equal(await verifyFirebaseIdToken("not.a.jwt", "vivid-cinema", keyFetch(), now), null);
});

test("health endpoint reports the worker scaffold without claiming a media backend exists", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.backendConfigured, false);
  assert.equal(body.storageBindingConfigured, true);
});

test("browser requests require the configured Firebase Hosting origin", async () => {
  const response = await worker.fetch(new Request("https://worker.example/api/v1/health", {
    headers: { Origin: "https://evil.example" }
  }), env);
  assert.equal(response.status, 403);
});

test("stream and download routes require Firebase authentication", async () => {
  const stream = await worker.fetch(new Request("https://worker.example/api/v1/stream/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: "550", mediaType: "movie" })
  }), env);
  assert.equal(stream.status, 401);

  const download = await worker.fetch(new Request("https://worker.example/api/v1/downloads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: "550", mediaType: "movie" })
  }), env);
  assert.equal(download.status, 401);
});

test("authenticated requests fail closed until a real MediaForge worker is connected", async () => {
  const token = await makeToken();
  const response = await worker.fetch(new Request("https://worker.example/api/v1/stream/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      Origin: env.ALLOWED_ORIGIN
    },
    body: JSON.stringify({ mediaId: "550", mediaType: "movie" })
  }), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGIN);
  assert.equal((await response.json()).error, "media_backend_not_configured");
});

test("rejects malformed media identities and unknown routes", async () => {
  const invalid = await worker.fetch(new Request("https://worker.example/api/v1/stream/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: "../secret", mediaType: "movie" })
  }), env);
  assert.equal(invalid.status, 400);

  const missing = await worker.fetch(new Request("https://worker.example/not-a-route"), env);
  assert.equal(missing.status, 404);
});
