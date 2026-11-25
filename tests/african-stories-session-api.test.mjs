import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../cloudflare/functions/api/african-stories/session.js";

function request(body, origin = "https://vivid.test") {
  return new Request("https://vivid.test/api/african-stories/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body)
  });
}

const valid = { titleId: "film-001", editionId: "film-001-restored", sourceId: "partner-001" };

test("provider-session API fails closed when no trusted provider registry is configured", async () => {
  const response = await onRequest({ request: request(valid), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "provider-registry-empty");
});

test("provider-session API rejects malformed title, edition and source identities", async () => {
  const response = await onRequest({ request: request({ ...valid, titleId: "../secret" }), env: { AFRICAN_STORIES_PROVIDER: { fetch() {} } } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid-identity");
});

test("provider-session API rejects cross-origin browser requests", async () => {
  const response = await onRequest({ request: request(valid, "https://attacker.test"), env: { AFRICAN_STORIES_PROVIDER: { fetch() {} } } });
  assert.equal(response.status, 403);
});

test("provider-session API forwards identities only to the trusted service binding", async () => {
  let forwarded;
  const binding = {
    async fetch(url, init) {
      forwarded = { url: String(url), body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        ok: true,
        playbackUrl: "https://media.partner.example/session/master.m3u8",
        expiresAt: "2026-11-25T00:10:00.000Z",
        mimeType: "application/vnd.apple.mpegurl",
        sessionId: "session-opaque-001"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  };
  const response = await onRequest({ request: request(valid), env: { AFRICAN_STORIES_PROVIDER: binding } });
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://african-stories-provider.internal/session");
  assert.deepEqual({ titleId: forwarded.body.titleId, editionId: forwarded.body.editionId, sourceId: forwarded.body.sourceId }, valid);
  assert.equal(Object.hasOwn(forwarded.body, "playbackUrl"), false);
  assert.equal((await response.json()).ok, true);
});
