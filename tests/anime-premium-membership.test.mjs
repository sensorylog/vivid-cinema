import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, client, returnHtml, returnScript, pricing, checkout, pageCheckout, webhook, membership, sendVerification, verifyEmail, sw, service, shell, headers, countriesApi, exchangeRateApi] = await Promise.all([
  read("../anime-premium-membership.html"),
  read("../scripts/anime-premium-membership.js"),
  read("../anime-premium-return.html"),
  read("../scripts/anime-premium-return.js"),
  read("../cloudflare/functions/api/anime-premium/pricing.js"),
  read("../cloudflare/functions/api/anime-premium/checkout.js"),
  read("../cloudflare/functions/api/anime-premium/page-checkout.js"),
  read("../cloudflare/functions/api/anime-premium/webhook.js"),
  read("../cloudflare/functions/api/anime-premium/membership.js"),
  read("../api/send-verification.js"),
  read("../scripts/verify-email.js"),
  read("../service-worker.js"),
  read("../cloudflare/functions/lib/anime-premium-service.js"),
  read("../scripts/app-shell.js"),
  read("../_headers"),
  read("../cloudflare/functions/api/anime-premium/countries.js"),
  read("../cloudflare/functions/api/anime-premium/exchange-rate.js")
]);

test("membership page offers country selection and only supported Paystack card checkout", () => {
  assert.match(html, /rel="canonical" href="https:\/\/vivid-cinema\.pages\.dev\/anime-premium-membership\.html"/);
  assert.match(html, /og:title/);
  assert.match(html, /id="vap-country"/);
  assert.match(html, /id="vap-card-method"/);
  assert.doesNotMatch(html, /value="mobile_money"|Automatic monthly renewal|Manual renewal each month/);
  assert.match(html, /anime-premium-membership\.js/);
  assert.doesNotMatch(html, /pk_live_|PaystackPop|PAYSTACK_SECRET_KEY/);
});

test("membership UI initialises pricing before Firebase auth and always exits loading states", () => {
  assert.doesNotMatch(client, /^import\s+\{\s*auth\s*\}\s+from\s+["']\.\/firebase\.js["']/m);
  assert.match(client, /import\("\.\/firebase\.js"\)/);
  assert.match(client, /9000, "Vivid sign-in initialisation timed out\."/);
  assert.match(client, /Promise\.allSettled\(\[countriesTask, pricingTask\]\)/);
  assert.match(client, /withTimeout\(fetch\("\/api\/anime-premium\/pricing"/);
  assert.match(client, /Checking checkout availability/);
  assert.match(client, /Checkout temporarily unavailable/);
  assert.match(client, /pricing\.checkoutMessage/);
  assert.match(client, /fetch\("\/api\/anime-premium\/exchange-rate\?currency=/);
  assert.match(client, /getExchangeRate\(localCurrency\)/);
  assert.doesNotMatch(client, /getExchangeRates\(/);
  assert.match(client, /auth\.authStateReady\(\)/);
  assert.match(client, /Signed in as .*Your existing Vivid account will own your Anime Premium membership/);
  assert.match(client, /getIdToken\(true\)/);
  assert.match(returnScript, /getIdToken\(true\)/);
  assert.match(client, /Reference rate: 1 GHS =/);
  assert.doesNotMatch(client, /textContent = "Rate unavailable"/);
  assert.match(client, /Local estimate temporarily unavailable/);
  assert.match(client, /bank\/card provider sets the final converted charge/);
  assert.match(client, /ANIME_PREMIUM_COUNTRIES/);
  assert.match(client, /window\.vividAuthResolved/);
  assert.match(client, /window\.vividAuthUser/);
  assert.doesNotMatch(client, /Complete country directory loaded|countries and territories available offline|vap-country-status/);
  assert.doesNotMatch(html, /vap-country-status|country directory loaded/i);
  assert.match(html, /exchangerate-api\.com/);
  assert.match(html, /currencyfreaks\.com\/open-rates-api/);
  assert.match(shell, /window\.vividAuthUser = user \|\| null/);
  assert.match(shell, /window\.vividAuthResolved = true/);
  assert.doesNotMatch(client, /restcountries\.com|annexare\/Countries/);
  assert.match(countriesApi, /ANIME_PREMIUM_COUNTRIES/);
  assert.match(countriesApi, /Do not fetch countries/);
  assert.match(countriesApi, /countries, count: countries\.length/);
  assert.doesNotMatch(client, /unique\.length < 180/);
  assert.match(client, /countries = ANIME_PREMIUM_COUNTRIES/);
  assert.match(client, /option\.textContent = .*country\.name.*country\.currency/);
  assert.match(client, /quote\.source/);
  assert.match(exchangeRateApi, /open\.er-api\.com\/v6\/latest\/USD/);
  assert.match(exchangeRateApi, /open-rates\.currencyfreaks\.com\/rates/);
  assert.match(exchangeRateApi, /payload\?\.base_code !== "USD"/);
  assert.match(exchangeRateApi, /payload\?\.base !== "USD"/);
  assert.match(exchangeRateApi, /targetPerUsd \* usdPerGhs/);
  assert.match(client, /no separately assigned local currency/);
  assert.match(exchangeRateApi, /cacheTtl: 86400/);
  assert.match(client, /Ghanaian Cedis/);
  assert.match(client, /localStorage\.setItem\("vivid:anime-premium-country"/);
});

test("client selects one of the three server-owned hosted Paystack plan pages", () => {
  assert.match(client, /fetch\("\/api\/anime-premium\/page-checkout"/);
  assert.match(client, /JSON\.stringify\(\{ planId: selectedPlanId \}\)/);
  assert.match(client, /data-vap-plan/);
  assert.match(client, /monthly: \{ amountMajor: 53\.30/);
  assert.match(client, /biannually: \{ amountMajor: 287\.82/);
  assert.match(client, /annually: \{ amountMajor: 511\.68/);
  assert.doesNotMatch(client, /PAYSTACK_SECRET_KEY|pk_live_|PaystackPop/);
});

test("hosted page checkout requires verified identity and maps the three plans server-side", () => {
  assert.match(pageCheckout, /requirePremiumUser/);
  assert.match(pageCheckout, /isValidEmailAddress\(email\)/);
  assert.doesNotMatch(pageCheckout, /\\\\\\\\s@/);
  assert.match(pageCheckout, /PAYSTACK_SECRET_KEY/);
  assert.doesNotMatch(pageCheckout, /paystackRequest/);
  assert.match(pageCheckout, /PAYSTACK_WEBHOOK_SECRET \|\| env\.PAYSTACK_SECRET_KEY/);
  assert.match(pageCheckout, /paymentPageUrl\.searchParams\.set\("email", email\)/);
  assert.match(pageCheckout, /paymentPageUrl\.searchParams\.set\("read-only", "email"\)/);
  assert.match(pageCheckout, /checkoutSource: "hosted_payment_page"/);
  assert.doesNotMatch(pageCheckout, /PAYSTACK_LIVE_ENABLED/);
  assert.match(pageCheckout, /monthly: \{ amount: 5330, currency: "GHS", url:/);
  assert.match(pageCheckout, /biannually: \{ amount: 28782, currency: "GHS", url:/);
  assert.match(pageCheckout, /annually: \{ amount: 51168, currency: "GHS", url:/);
});

test("webhook verification is the source of truth for membership activation and renewals", () => {
  assert.match(webhook, /verifyPaystackSignature/);
  assert.match(webhook, /transaction\/verify/);
  assert.match(webhook, /Payment Page transactions have Paystack-generated references/);
  assert.match(webhook, /matches\.length !== 1/);
  assert.match(webhook, /Hosted Paystack charge has no subscription evidence/);
  assert.match(webhook, /\^SUB_\[A-Za-z0-9\]\{6,80\}\$\/i\.test\(subscriptionCode\)/);
  assert.match(webhook, /data\.subscription\?\.amount/);
  assert.match(webhook, /checkoutSource === "hosted_payment_page"/);
  assert.match(webhook, /eventName === "charge\.success"/);
  assert.match(webhook, /invoice\.payment_success/);
  assert.match(webhook, /eventName === "invoice\.update"/);
  assert.match(webhook, /invoice-payment-mismatch/);
  assert.match(webhook, /Number\(value\.amount\)/);
  assert.match(webhook, /invoice\.payment_failed/);
  assert.match(webhook, /animePremiumMemberships/);
  assert.match(membership, /canCancelAutoRenew: Boolean\(env\.PAYSTACK_SECRET_KEY && data\.autoRenew/);
  assert.match(membership, /animePremiumMemberships/);
  assert.match(membership, /currentPeriodEnd/);
  assert.match(membership, /env\.PAYSTACK_SECRET_KEY && data\.autoRenew/);
});

test("payment return checks server membership and never grants access from the callback", () => {
  assert.match(returnScript, /api\/anime-premium\/membership/);
  assert.doesNotMatch(returnScript, /PaystackPop|transaction\/verify|setDoc|updateDoc/);
  assert.match(returnHtml, /Membership activation is confirmed only by Vivid’s server/);
});

test("membership return survives Vivid email verification and is cached offline", () => {
  assert.match(sendVerification, /anime-premium-membership\.html/);
  assert.match(verifyEmail, /anime-premium-membership\.html/);
  assert.match(sw, /vivid-cinema-shell-v371/);
  assert.match(sw, /anime-premium-membership\.html/);
  assert.match(sw, /anime-premium-return\.html/);
  assert.match(sw, /anime-premium-membership\.js/);
  assert.match(sw, /anime-premium-return\.js/);
  assert.match(pricing, /publicPricing/);
  assert.match(service, /PAYSTACK_WEBHOOK_SECRET/);
  assert.match(service, /claims\.email_verified !== true/);
  assert.doesNotMatch(service, /sign_in_provider/);
  assert.match(service, /export function isValidEmailAddress/);
  assert.match(service, /checkoutEnabled: Boolean\(env\.FIREBASE_SERVICE_ACCOUNT_JSON && \(env\.PAYSTACK_WEBHOOK_SECRET \|\| env\.PAYSTACK_SECRET_KEY\)\)/);
  assert.match(service, /const webhookSecret = String\(env\.PAYSTACK_WEBHOOK_SECRET \|\| ""\)/);
  assert.match(service, /const secret = String\(env\.PAYSTACK_SECRET_KEY \|\| ""\)/);
});
