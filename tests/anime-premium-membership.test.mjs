import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, client, returnHtml, returnScript, pricing, checkout, webhook, membership, sendVerification, verifyEmail, sw, service] = await Promise.all([
  read("../anime-premium-membership.html"),
  read("../scripts/anime-premium-membership.js"),
  read("../anime-premium-return.html"),
  read("../scripts/anime-premium-return.js"),
  read("../cloudflare/functions/api/anime-premium/pricing.js"),
  read("../cloudflare/functions/api/anime-premium/checkout.js"),
  read("../cloudflare/functions/api/anime-premium/webhook.js"),
  read("../cloudflare/functions/api/anime-premium/membership.js"),
  read("../api/send-verification.js"),
  read("../scripts/verify-email.js"),
  read("../service-worker.js"),
  read("../cloudflare/functions/lib/anime-premium-service.js")
]);

test("membership page offers global country selection and separate renewal methods", () => {
  assert.match(html, /id="vap-country"/);
  assert.match(html, /value="card"/);
  assert.match(html, /value="mobile_money"/);
  assert.match(html, /Automatic monthly renewal/);
  assert.match(html, /Manual renewal each month/);
  assert.match(html, /anime-premium-membership\.js/);
  assert.doesNotMatch(html, /pk_live_|PaystackPop|PAYSTACK_SECRET_KEY/);
});

test("local currency display is an estimate while Paystack checkout currency is explicit", () => {
  assert.match(client, /restcountries\.com/);
  assert.match(client, /open\.er-api\.com/);
  assert.match(client, /Estimated local equivalent/);
  assert.match(client, /Paystack checkout will charge/);
  assert.match(client, /localStorage\.setItem\("vivid:anime-premium-country"/);
});

test("client sends only country and payment method; server owns the amount and Paystack secret", () => {
  assert.match(client, /fetch\("\/api\/anime-premium\/checkout"/);
  assert.match(client, /JSON\.stringify\(\{ country: selectedCountry, paymentMethod: selectedPaymentMethod \}\)/);
  assert.doesNotMatch(client, /PAYSTACK_SECRET_KEY|pk_live_|PaystackPop/);
  assert.match(checkout, /paystackRequest\(env, "\/transaction\/initialize"/);\n  assert.match(service, /PAYSTACK_SECRET_KEY/);
  assert.match(checkout, /PAYSTACK_LIVE_ENABLED !== "true"/);
  assert.match(client, /pricing\.checkoutEnabled/);
  assert.match(checkout, /plan: plan\.planCode/);
  assert.match(checkout, /channels: paymentMethod === "card" \? \["card"\] : \["mobile_money"\]/);
  assert.match(checkout, /renewalMode = paymentMethod === "card" \? "automatic" : "manual"/);
});

test("webhook verification is the source of truth for membership activation and renewals", () => {
  assert.match(webhook, /verifyPaystackSignature/);
  assert.match(webhook, /transaction\/verify/);
  assert.match(webhook, /eventName === "charge\.success"/);
  assert.match(webhook, /invoice\.payment_success/);
  assert.match(webhook, /invoice\.payment_failed/);
  assert.match(webhook, /animePremiumMemberships/);
  assert.match(membership, /animePremiumMemberships/);
  assert.match(membership, /currentPeriodEnd/);
});

test("payment return checks server membership and never grants access from the callback", () => {
  assert.match(returnScript, /api\/anime-premium\/membership/);
  assert.doesNotMatch(returnScript, /PaystackPop|transaction\/verify|setDoc|updateDoc/);
  assert.match(returnHtml, /Membership activation is confirmed only by Vivid’s server/);
});

test("membership return survives Vivid email verification and is cached offline", () => {
  assert.match(sendVerification, /anime-premium-membership\.html/);
  assert.match(verifyEmail, /anime-premium-membership\.html/);
  assert.match(sw, /vivid-cinema-shell-v337/);
  assert.match(sw, /anime-premium-membership\.html/);
  assert.match(sw, /anime-premium-return\.html/);
  assert.match(sw, /anime-premium-membership\.js/);
  assert.match(sw, /anime-premium-return\.js/);
  assert.match(pricing, /publicPricing/);
});
