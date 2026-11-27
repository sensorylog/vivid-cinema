import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { onRequest as appCheckRoute } from "../cloudflare/functions/api/app-check.js";
import { createFirebaseAppCheckToken } from "../cloudflare/functions/lib/firebase-token-verification.js";
import { verifyTurnstileToken } from "../cloudflare/functions/lib/turnstile.js";
import { readFile } from "node:fs/promises";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
const serviceAccount = {
  project_id: "vivid-cinema",
  client_email: "vivid-app-check-test@vivid-cinema.iam.gserviceaccount.com",
  private_key: privateKey
};
const env = {
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  FIREBASE_PROJECT_ID: "vivid-cinema",
  TURNSTILE_SITE_KEY: "test-site-key",
  TURNSTILE_SECRET_KEY: "test-secret-key"
};
const origin = "https://vivid-cinema.pages.dev";

test("Turnstile Siteverify rejects invalid, replayed, wrong-host and wrong-action proofs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, "POST");
      return new Response(JSON.stringify({
        success: true,
        hostname: "vivid-cinema.pages.dev",
        action: "vivid_app_check"
      }), { status: 200 });
    };
    await verifyTurnstileToken("valid-proof", "secret", "vivid-cinema.pages.dev", "vivid_app_check");
    await assert.rejects(
      verifyTurnstileToken("valid-proof", "secret", "attacker.example", "vivid_app_check"),
      error => error.code === "turnstile/claims-mismatch"
    );
    await assert.rejects(
      verifyTurnstileToken("valid-proof", "secret", "vivid-cinema.pages.dev", "watch_rooms"),
      error => error.code === "turnstile/claims-mismatch"
    );
    globalThis.fetch = async () => new Response(JSON.stringify({
      success: false,
      "error-codes": ["timeout-or-duplicate"]
    }), { status: 200 });
    await assert.rejects(
      verifyTurnstileToken("replayed-proof", "secret", "vivid-cinema.pages.dev", "vivid_app_check"),
      error => error.code === "turnstile/verification-failed"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare worker mints a real Firebase App Check token using the service account", async () => {
  const originalFetch = globalThis.fetch;
  let exchangeCount = 0;
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "test-google-access-token", expires_in: 3600 }), { status: 200 });
      }
      if (String(url).includes("firebaseappcheck.googleapis.com/v1/projects/")) {
        exchangeCount++;
        assert.equal(options.headers.Authorization, "Bearer test-google-access-token");
        const { customToken } = JSON.parse(options.body);
        const parts = customToken.split(".");
        assert.equal(parts.length, 3);
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        assert.equal(claims.iss, serviceAccount.client_email);
        assert.equal(claims.sub, serviceAccount.client_email);
        assert.equal(claims.app_id, "1:1016345599146:web:bc00fd2f6ac15486ba44d3");
        assert.equal(claims.aud, "https://firebaseappcheck.googleapis.com/google.firebase.appcheck.v1.TokenExchangeService");
        assert.equal(claims.ttl, "3600s");
        const verifier = createVerify("RSA-SHA256");
        verifier.update(parts[0] + "." + parts[1]);
        verifier.end();
        assert.equal(verifier.verify(publicKey, Buffer.from(parts[2], "base64url")), true);
        return new Response(JSON.stringify({ token: "firebase-issued-app-check-token", ttl: "3600s" }), { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    };

    const token = await createFirebaseAppCheckToken(
      "1:1016345599146:web:bc00fd2f6ac15486ba44d3",
      "vivid-cinema",
      serviceAccount,
      60 * 60 * 1000
    );
    assert.equal(token.token, "firebase-issued-app-check-token");
    assert.equal(token.ttlMillis, 60 * 60 * 1000);
    assert.equal(exchangeCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare App Check endpoint exposes only the public site key and enforces allowed origins", async () => {
  const good = await appCheckRoute({
    request: new Request(origin + "/api/app-check", {
      method: "GET",
      headers: { Origin: origin }
    }),
    env
  });
  assert.equal(good.status, 200);
  const payload = await good.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.siteKey, "test-site-key");
  assert.equal(Object.hasOwn(payload, "secret"), false);

  const bad = await appCheckRoute({
    request: new Request("https://vivid-cinema.pages.dev/api/app-check", {
      method: "GET",
      headers: { Origin: "https://attacker.example" }
    }),
    env
  });
  assert.equal(bad.status, 403);
});

test("Cloudflare App Check endpoint verifies Turnstile then returns a Firebase-issued token", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("challenges.cloudflare.com/turnstile/v0/siteverify")) {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("secret"), "test-secret-key");
        assert.equal(form.get("response"), "valid-turnstile-proof");
        return new Response(JSON.stringify({
          success: true,
          hostname: "vivid-cinema.pages.dev",
          action: "vivid_app_check"
        }), { status: 200 });
      }
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "test-google-access-token", expires_in: 3600 }), { status: 200 });
      }
      if (String(url).includes("firebaseappcheck.googleapis.com/v1/projects/")) {
        return new Response(JSON.stringify({ token: "server-minted-app-check-token", ttl: "3600s" }), { status: 200 });
      }
      throw new Error("Unexpected request: " + url);
    };

    const response = await appCheckRoute({
      request: new Request(origin + "/api/app-check", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: "valid-turnstile-proof" })
      }),
      env
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.token, "server-minted-app-check-token");
    assert.ok(payload.expireTimeMillis > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vivid App Check no longer initializes the reCAPTCHA Enterprise provider", async () => {
  const firebase = await readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  const pulse = await readFile(new URL("../scripts/vivid-pulse.js", import.meta.url), "utf8");
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");
  assert.match(firebase, /export async function ensureAppCheck\(\)/);
  assert.match(firebase, /new CustomProvider\(\{ getToken: getTurnstileAppCheckToken \}\)/);
  const provider = await readFile(new URL("../scripts/turnstile-app-check.js", import.meta.url), "utf8");
  const auth = await readFile(new URL("../scripts/auth.js", import.meta.url), "utf8");
  assert.match(provider, /const showSignupOverlay = isSignupChallenge\(\)/);
  assert.match(provider, /if \(showSignupOverlay\)/);
  assert.match(auth, /vivid:signup-verification/);
  assert.match(auth, /markSignupVerification\(\)/);
  assert.doesNotMatch(pulse, /signInAnonymously|getAnonymousUser|anonymousApp|initializeAppCheck/);
  assert.match(pulse, /if \(user && !user\.isAnonymous\)/);
  assert.doesNotMatch(firebase + pulse, /ReCaptchaEnterpriseProvider|RECAPTCHA_ENTERPRISE_SITE_KEY/);
  assert.match(headers, /https:\/\/challenges\.cloudflare\.com/);
});


test("Account creation, sign-in and the synced library keep their Firebase SDK paths", async () => {
  const [firebase, auth, library] = await Promise.all([
    readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/library.js", import.meta.url), "utf8")
  ]);
  assert.match(firebase, /initializeAuth\(app/);
  assert.match(firebase, /getFirestore\(app\)/);
  assert.match(firebase, /initializeAppCheck\(app/);
  assert.match(auth, /verifyNewAccountBrowser\(\)/);
  assert.match(auth, /createUserWithEmailAndPassword\(auth/);
  assert.match(auth, /signInWithEmailAndPassword\(auth/);
  assert.match(auth, /signInWithPopup\(auth/);
  assert.match(library, /getDocsFromServer/);
  assert.match(library, /setDoc\(doc\(db,\s*"users",\s*uid/);
});


test("Turnstile script loading and verification cannot leave App Check pending forever", async () => {
  const provider = await readFile(new URL("../scripts/turnstile-app-check.js", import.meta.url), "utf8");
  const loaderStart = provider.indexOf("function loadTurnstile()");
  const loaderEnd = provider.indexOf("async function getConfig()", loaderStart);
  const loader = provider.slice(loaderStart, loaderEnd);
  assert.match(loader, /12_000/);
  assert.match(loader, /window\.clearTimeout\(timeout\)/);
  assert.match(loader, /script\.remove\(\)/);
  assert.ok(loader.indexOf("window.setTimeout") < loader.indexOf("document.head.append(script)"));
  assert.match(provider, /20_000/);
  assert.match(provider, /8_000/);
  assert.match(provider, /10_000/);
  assert.match(provider, /controller\.abort\(\)/);
});
