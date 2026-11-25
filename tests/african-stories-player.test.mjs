import test from "node:test";
import assert from "node:assert/strict";
import { requestAfricanProviderSession } from "../scripts/african-stories/provider-session.js";
import {
  getAfricanAccessMessage,
  getPlayableAfricanSources,
  isAfricanSourcePlayable,
  isGrantCurrent
} from "../scripts/african-stories/policy.js";

const now = Date.parse("2026-11-25T00:00:00.000Z");
const grant = {
  status: "verified",
  rightsHolder: "Example rights holder",
  basis: "Written non-exclusive streaming licence",
  evidenceRef: "rights-record-001",
  territories: ["GH"],
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
};
const title = {
  id: "ghana-film-001",
  editionId: "ghana-film-001-restored",
  published: true,
  accessState: "stream_on_vivid",
  rightsGrant: grant
};
const source = {
  sourceId: "partner-stream-001",
  provider: "partner",
  label: "Authorized partner",
  enabled: true,
  authorized: true,
  status: "active",
  authorization: { status: "verified", evidenceRef: "contract-001", authorizedBy: "rights-team" },
  priority: 1
};

test("requires a verified, evidenced, in-date rights grant", () => {
  assert.equal(isGrantCurrent(grant, { territory: "GH", now }), true);
  assert.equal(isGrantCurrent({ ...grant, evidenceRef: "" }, { territory: "GH", now }), false);
  assert.equal(isGrantCurrent({ ...grant, expiresAt: "2026-11-24T00:00:00.000Z" }, { territory: "GH", now }), false);
  assert.equal(isGrantCurrent(grant, { territory: "NG", now }), false);
});

test("only published titles with explicit authorized source records can play", () => {
  assert.equal(isAfricanSourcePlayable(title, source, { territory: "GH", now }), true);
  assert.equal(isAfricanSourcePlayable({ ...title, published: false }, source, { territory: "GH", now }), false);
  assert.equal(isAfricanSourcePlayable(title, { ...source, authorized: false }, { territory: "GH", now }), false);
  assert.equal(isAfricanSourcePlayable(title, { ...source, provider: "unregistered" }, { territory: "GH", now }), false);
  assert.equal(isAfricanSourcePlayable(title, { ...source, authorization: { status: "pending" } }, { territory: "GH", now }), false);
  assert.equal(isAfricanSourcePlayable({ ...title, accessState: "discover_archive_record" }, source, { territory: "GH", now }), false);
});

test("filters and orders eligible sources without changing catalogue records", () => {
  const later = { ...source, sourceId: "partner-stream-002", priority: 5 };
  const first = { ...source, sourceId: "partner-stream-001", priority: 1 };
  const blocked = { ...source, sourceId: "pending", authorized: false };
  assert.deepEqual(getPlayableAfricanSources({ ...title, sources: [later, blocked, first] }, { territory: "GH", now }).map(item => item.sourceId), ["partner-stream-001", "partner-stream-002"]);
});

test("access messaging never implies that catalogue discovery grants playback", () => {
  assert.match(getAfricanAccessMessage({ accessState: "discover_archive_record" }), /no public viewing route/i);
  assert.match(getAfricanAccessMessage({ accessState: "access_pending" }), /No stream is available/i);
});

test("an empty catalogue remains safe and does not invent playable titles", () => {
  assert.deepEqual(getPlayableAfricanSources({ id: "empty", sources: [] }), []);
});

test("partner playback requests send title identities, never a browser-supplied stream URL", async () => {
  let requestBody;
  const title = { id: "film-001", editionId: "film-001-restored" };
  const source = { sourceId: "partner-001", provider: "partner" };
  const session = await requestAfricanProviderSession(title, source, async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      ok: true,
      playbackUrl: "https://media.partner.example/session/master.m3u8",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      mimeType: "application/vnd.apple.mpegurl",
      sessionId: "session_opaque_001"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(requestBody, { titleId: "film-001", editionId: "film-001-restored", sourceId: "partner-001" });
  assert.equal(session.mimeType, "application/vnd.apple.mpegurl");
  assert.equal(new URL(session.url).protocol, "https:");
});

test("partner playback rejects expired and insecure session envelopes", async () => {
  const title = { id: "film-001", editionId: "film-001-restored" };
  const source = { sourceId: "partner-001", provider: "partner" };
  const responseFor = payload => async () => new Response(JSON.stringify({ ok: true, ...payload }), { status: 200 });
  await assert.rejects(requestAfricanProviderSession(title, source, responseFor({
    playbackUrl: "https://media.partner.example/master.m3u8",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    mimeType: "application/vnd.apple.mpegurl",
    sessionId: "session_opaque_001"
  })), /invalid or expired/i);
  await assert.rejects(requestAfricanProviderSession(title, source, responseFor({
    playbackUrl: "http://media.partner.example/master.m3u8",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    mimeType: "application/vnd.apple.mpegurl",
    sessionId: "session_opaque_001"
  })), /invalid or expired/i);
});
