import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, client, members, sources, cancel, webhook, rules] = await Promise.all([
  read("../anime-premium-admin.html"),
  read("../scripts/anime-premium-admin.js"),
  read("../cloudflare/functions/api/anime-premium/admin/memberships.js"),
  read("../cloudflare/functions/api/anime-premium/admin/sources.js"),
  read("../cloudflare/functions/api/anime-premium/cancel.js"),
  read("../cloudflare/functions/api/anime-premium/webhook.js"),
  read("../firestore.rules")
]);

test("admin page provides audited membership and authorised source operations", () => {
  assert.match(html, /vap-admin-membership-form/);
  assert.match(html, /vap-admin-source-form/);
  assert.match(html, /vap-admin-territories/);
  assert.match(html, /vap-admin-rights-reference/);
  assert.match(html, /vap-admin-license-start/);
  assert.match(html, /vap-admin-license-end/);
  assert.match(html, /vap-admin-rights-verified/);
  assert.match(client, /allowedTerritories:/);
  assert.match(client, /rightsReference:/);
  assert.match(client, /licenseStartsAt:/);
  assert.match(client, /licenseEndsAt:/);
  assert.match(client, /rightsVerified:/);
  assert.match(sources, /rightsVerified !== true/);
  assert.match(sources, /allowedTerritories/);
  assert.match(sources, /licenseEndsAt/);
  assert.match(html, /server-verified operations/i);
  assert.match(client, /getIdToken\(\)/);
  assert.match(client, /api\/anime-premium\/admin\/memberships/);
  assert.match(client, /api\/anime-premium\/admin\/sources/);
  assert.doesNotMatch(client, /getFirestore|setDoc|updateDoc|collection\(/);
});

test("admin APIs require server-verified admin claims or UID allowlist and audit changes", () => {
  assert.match(members, /user\.admin !== true/);
  assert.match(members, /ANIME_PREMIUM_ADMIN_UIDS/);
  assert.match(members, /animePremiumAdminAudit/);
  assert.match(sources, /user\.animePremiumAdmin !== true/);
  assert.match(sources, /animePremiumAdminAudit/);
  assert.match(sources, /sourceId/);
  assert.doesNotMatch(sources, /manifestUrl|streamUrl|playbackUrl/);
});

test("card auto-renew cancellation uses stored Paystack subscription credentials", () => {
  assert.match(cancel, /subscriptionEmailToken/);
  assert.match(cancel, /subscriptionCode/);
  assert.match(cancel, /subscription\/disable/);
  assert.match(cancel, /cancelAtPeriodEnd: true/);
  assert.doesNotMatch(cancel, /currentPeriodEnd\s*:/);
});

test("server-only Firestore collections remain private to all browser clients", () => {
  for (const collection of ["animePremiumMemberships", "animePremiumCheckouts", "animePremiumWebhookEvents", "animePremiumPendingSubscriptions", "animePremiumSources", "animePremiumProfiles", "animePremiumPlaybackSessions", "animePremiumRateLimits", "animePremiumAdminAudit"]) {
    assert.match(rules, new RegExp("match \\/" + collection + "\\/"));
  }
  assert.match(rules, /allow read, write: if false/);
});

test("subscription creation webhooks preserve server-side renewal credentials", () => {
  assert.match(webhook, /subscription\.create/);
  assert.match(webhook, /subscriptionEmailToken/);
  assert.match(webhook, /subscriptionCode/);
});
