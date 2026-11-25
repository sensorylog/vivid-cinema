import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequest as submit } from "../cloudflare/functions/api/african-stories/submissions.js";
import { onRequest as metrics } from "../cloudflare/functions/api/african-stories/metrics.js";
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const makeRequest = (url, body, headers = {}) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(url).origin, ...headers }, body: JSON.stringify(body)
});
const valid = { title: "Test film", countryCode: "GH", format: "documentary", year: 2020, languages: ["English", "Twi"], submitterName: "Rights Holder", role: "rights_holder", email: "rights@example.org", projectUrl: "https://example.org/film", note: "", rightsDeclaration: true, privacyConsent: true };
test("intake fails closed without a secure processor", async () => {
  const response = await submit({ request: makeRequest("https://vivid.example/api/african-stories/submissions", valid), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "intake-not-configured");
});
test("intake rejects missing rights declaration and cross-origin requests", async () => {
  const env = { AFRICAN_STORIES_INTAKE: { fetch: async () => new Response(JSON.stringify({ ok: true, reference: "REF-1234" }), { status: 202 }) } };
  const missing = await submit({ request: makeRequest("https://vivid.example/api/african-stories/submissions", { ...valid, rightsDeclaration: false }), env });
  assert.equal(missing.status, 400);
  const cross = await submit({ request: makeRequest("https://vivid.example/api/african-stories/submissions", valid, { Origin: "https://attacker.example" }), env });
  assert.equal(cross.status, 403);
});
test("intake forwards validated submissions without granting rights", async () => {
  let forwarded;
  const env = { AFRICAN_STORIES_INTAKE: { fetch: async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, reference: "REF-1234" }), { status: 202 });
  } } };
  const response = await submit({ request: makeRequest("https://vivid.example/api/african-stories/submissions", valid), env });
  assert.equal(response.status, 202);
  assert.equal(forwarded.rightsGranted, false);
  assert.equal(forwarded.status, "received_for_review");
});
test("analytics requires explicit consent and a configured dataset", async () => {
  const noConsent = await metrics({ request: makeRequest("https://vivid.example/api/african-stories/metrics", { event: "atlas_view" }), env: {} });
  assert.equal(noConsent.status, 403);
  const noBinding = await metrics({ request: makeRequest("https://vivid.example/api/african-stories/metrics", { event: "atlas_view" }, { "X-Vivid-Analytics-Consent": "granted" }), env: {} });
  assert.equal(noBinding.status, 503);
});
test("analytics accepts aggregate allowlisted events and rejects personal fields", async () => {
  const points = [];
  const env = { AFRICAN_STORIES_ANALYTICS: { writeDataPoint: point => points.push(point) } };
  const accepted = await metrics({ request: makeRequest("https://vivid.example/api/african-stories/metrics", { event: "title_open", countryCode: "GH", accessState: "discover_archive_record" }, { "X-Vivid-Analytics-Consent": "granted" }), env });
  assert.equal(accepted.status, 202);
  assert.equal(points.length, 1);
  const rejected = await metrics({ request: makeRequest("https://vivid.example/api/african-stories/metrics", { event: "title_open", email: "private@example.org" }, { "X-Vivid-Analytics-Consent": "granted" }), env });
  assert.equal(rejected.status, 400);
});
test("partner pipeline and launch gates never imply deals or launch readiness", async () => {
  const partners = JSON.parse(await read("../data/african-stories-partners.json"));
  const gates = JSON.parse(await read("../data/african-stories-launch-gates.json"));
  assert.ok(partners.partners.length >= 5);
  assert.ok(partners.partners.every(item => item.status === "research_target" && item.source.startsWith("https://")));
  assert.equal(gates.releaseState, "not_ready");
  assert.equal(gates.launchPolicy.allowVividPlayback, false);
  assert.equal(gates.launchPolicy.allowPartnerClaims, false);
});
test("public intake and operational plan include rights and staged launch boundaries", async () => {
  const html = await read("../african-stories-submit.html");
  const docs = await read("../docs/african-stories-phase-6-7.md");
  assert.match(html, /rightsDeclaration/);
  assert.match(html, /privacyConsent/);
  assert.match(docs, /no ingest or playback before signed authority/);
  assert.match(docs, /Stage 3 — measured expansion/);
});