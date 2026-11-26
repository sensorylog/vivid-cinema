const $ = id => document.getElementById(id);
const COUNTRY_TO_PAYSTACK = { GH: "GHS", NG: "NGN", KE: "KES", ZA: "ZAR", US: "USD", GB: "USD", CA: "USD", AU: "USD", IN: "USD", DE: "USD", FR: "USD", ES: "USD", IT: "USD", NL: "USD", BE: "USD", IE: "USD", PT: "USD", SE: "USD", NO: "USD", DK: "USD", FI: "USD", CH: "USD", AE: "USD", SA: "USD", EG: "USD", MA: "USD", BR: "USD", MX: "USD", JP: "USD", KR: "USD", SG: "USD", MY: "USD", ID: "USD", PH: "USD", TH: "USD", NZ: "USD", UG: "USD", TZ: "USD", RW: "USD", CI: "USD", SN: "USD", CM: "USD", ET: "USD" };
const MOBILE_MONEY_COUNTRIES = new Set(["GH", "KE"]);
const FALLBACK_COUNTRIES = [
  { code: "GH", name: "Ghana", currency: "GHS" }, { code: "NG", name: "Nigeria", currency: "NGN" },
  { code: "KE", name: "Kenya", currency: "KES" }, { code: "ZA", name: "South Africa", currency: "ZAR" },
  { code: "US", name: "United States", currency: "USD" }, { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "CA", name: "Canada", currency: "CAD" }, { code: "AU", name: "Australia", currency: "AUD" },
  { code: "IN", name: "India", currency: "INR" }, { code: "DE", name: "Germany", currency: "EUR" },
  { code: "FR", name: "France", currency: "EUR" }, { code: "AE", name: "United Arab Emirates", currency: "AED" },
  { code: "JP", name: "Japan", currency: "JPY" }, { code: "SG", name: "Singapore", currency: "SGD" },
  { code: "UG", name: "Uganda", currency: "UGX" }, { code: "TZ", name: "Tanzania", currency: "TZS" },
  { code: "RW", name: "Rwanda", currency: "RWF" }, { code: "CI", name: "Côte d’Ivoire", currency: "XOF" },
  { code: "SN", name: "Senegal", currency: "XOF" }, { code: "BR", name: "Brazil", currency: "BRL" }
];
let pricing = null;
let countries = FALLBACK_COUNTRIES;
let currentUser = null;
let membershipActive = false;
let membershipAutoRenew = false;
let membershipStatusUnavailable = false;
let membershipVerificationRequired = false;
let selectedCountry = "GH";
let selectedPaymentMethod = "card";
const rateCache = new Map();

function getCountry(code) { return countries.find(country => country.code === code) || FALLBACK_COUNTRIES[0]; }
function getCheckoutCurrency(countryCode) {
  const preferred = COUNTRY_TO_PAYSTACK[countryCode] || pricing.defaultCurrency;
  return pricing.plans[preferred] ? preferred : pricing.defaultCurrency;
}
function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return amount.toFixed(2) + " " + currency; }
}
async function loadCountries() {
  try {
    const response = await fetch("https://restcountries.com/v3.1/all?fields=cca2,name,currencies", { cache: "force-cache", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Country list unavailable");
    const data = await response.json();
    const parsed = data.map(country => {
      const currency = Object.keys(country.currencies || {})[0] || "";
      return {
        code: String(country.cca2 || "").toUpperCase(),
        name: country.name?.common || country.cca2,
        currency
      };
    }).filter(country => /^[A-Z]{2}$/.test(country.code) && country.name);
    if (parsed.length > 100) countries = parsed.sort((a,b) => a.name.localeCompare(b.name));
  } catch {
    countries = FALLBACK_COUNTRIES;
  }
  const select = $("vap-country");
  const saved = localStorage.getItem("vivid:anime-premium-country") || "GH";
  const current = countries.some(country => country.code === saved) ? saved : "GH";
  select.innerHTML = countries.map(country =>
    '<option value="' + country.code + '">' + country.name.replace(/[&<>"]/g, "") + '</option>'
  ).join("");
  select.value = current;
  selectedCountry = current;
}
async function getExchangeRates(baseCurrency) {
  if (rateCache.has(baseCurrency)) return rateCache.get(baseCurrency);
  const promise = fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(baseCurrency), { cache: "no-store", signal: AbortSignal.timeout(5000) })
    .then(response => response.ok ? response.json() : Promise.reject(new Error("Exchange rates unavailable")))
    .then(data => data.result === "success" && data.rates ? data.rates : null)
    .catch(() => null);
  rateCache.set(baseCurrency, promise);
  return promise;
}
async function updatePrice() {
  if (!pricing) return;
  const country = getCountry(selectedCountry);
  const localCurrency = country.currency || pricing.defaultCurrency;
  const checkoutCurrency = getCheckoutCurrency(selectedCountry);
  const plan = pricing.plans[checkoutCurrency];
  $("vap-local-currency").textContent = localCurrency;
  $("vap-checkout-currency").textContent = checkoutCurrency;
  if (!plan) {
    $("vap-local-price").textContent = "Price unavailable";
    $("vap-price-note").textContent = "Vivid has not configured a checkout price for this region yet.";
    $("vap-checkout-button").disabled = true;
    $("vap-checkout-status").textContent = "No checkout price is configured for this country yet. Please choose another region or contact Vivid support.";
    return;
  }
  const baseAmount = Number(plan.amountMajor);
  if (localCurrency === checkoutCurrency) {
    $("vap-local-price").textContent = formatMoney(baseAmount, checkoutCurrency);
    $("vap-price-note").textContent = "Exact checkout currency. Paystack will confirm the final amount before payment.";
  } else {
    const rates = await getExchangeRates(checkoutCurrency);
    const rate = rates?.[localCurrency];
    if (Number.isFinite(rate) && rate > 0) {
      $("vap-local-price").textContent = "≈ " + formatMoney(baseAmount * rate, localCurrency);
      $("vap-price-note").textContent = "Estimated local equivalent. Paystack checkout will charge " + formatMoney(baseAmount, checkoutCurrency) + " in " + checkoutCurrency + ".";
    } else {
      $("vap-local-price").textContent = formatMoney(baseAmount, checkoutCurrency);
      $("vap-price-note").textContent = "Local conversion is temporarily unavailable. Paystack will confirm the final " + checkoutCurrency + " amount before payment.";
    }
  }
  const cardRadio = document.querySelector('input[name="vap-payment-method"][value="card"]');
  const mobileRadio = document.querySelector('input[name="vap-payment-method"][value="mobile_money"]');
  const cardAvailable = Boolean(plan.cardAutoRenewAvailable);
  const mobileAvailable = (pricing.mobileMoneyCountries || [...MOBILE_MONEY_COUNTRIES]).includes(selectedCountry) && ((selectedCountry === "GH" && checkoutCurrency === "GHS") || (selectedCountry === "KE" && checkoutCurrency === "KES"));
  cardRadio.disabled = !cardAvailable;
  mobileRadio.disabled = !mobileAvailable;
  $("vap-card-method").setAttribute("aria-disabled", String(!cardAvailable));
  $("vap-mobile-method").setAttribute("aria-disabled", String(!mobileAvailable));
  if (selectedPaymentMethod === "card" && !cardAvailable) selectedPaymentMethod = mobileAvailable ? "mobile_money" : "";
  if (selectedPaymentMethod === "mobile_money" && !mobileAvailable) selectedPaymentMethod = cardAvailable ? "card" : "";
  if (!selectedPaymentMethod && (cardAvailable || mobileAvailable)) selectedPaymentMethod = cardAvailable ? "card" : "mobile_money";
  if (selectedPaymentMethod) {
    document.querySelector('input[name="vap-payment-method"][value="' + selectedPaymentMethod + '"]').checked = true;
  }
  $("vap-method-note").textContent = selectedPaymentMethod === "card"
    ? "Card billing renews automatically each month where the configured Paystack plan supports it."
    : selectedPaymentMethod === "mobile_money"
      ? "Mobile money is a one-time payment. Renew manually each month; no automatic debit is created."
      : "No payment method is configured for this region yet.";
  const membershipBlocked = membershipStatusUnavailable || membershipVerificationRequired;
  $("vap-checkout-button").disabled = !pricing.checkoutEnabled || membershipBlocked || (membershipActive && membershipAutoRenew) || !selectedPaymentMethod;
  $("vap-checkout-button").textContent = membershipStatusUnavailable
    ? "Membership status unavailable"
    : membershipVerificationRequired
      ? "Verify email to subscribe"
      : !pricing.checkoutEnabled
        ? "Checkout temporarily unavailable"
        : membershipActive
          ? (membershipAutoRenew ? "Membership active — auto-renew on" : "Renew manually →")
          : currentUser ? "Continue to secure checkout →" : "Sign in to subscribe →";
  if (membershipStatusUnavailable) {
    $("vap-checkout-status").textContent = "Vivid could not verify your current membership. Reload this page and check again before paying.";
  } else if (membershipVerificationRequired) {
    $("vap-checkout-status").textContent = "Verify your Vivid email address before subscribing.";
  } else if (!pricing.checkoutEnabled) {
    $("vap-checkout-status").textContent = "Your membership price is available, but secure Paystack checkout has not been enabled in this environment.";
  } else if (!selectedPaymentMethod) {
    $("vap-checkout-status").textContent = "No supported payment method is configured for this country yet.";
  }
}
async function loadPricing() {
  const response = await fetch("/api/anime-premium/pricing", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || (response.status === 404
      ? "Premium pricing service is not deployed on this Vivid environment yet."
      : "Premium pricing is temporarily unavailable. Please try again shortly."));
  }
  if (!payload.plans || !Object.keys(payload.plans).length) throw new Error("No Premium checkout currency is configured yet.");
  pricing = payload;
  await updatePrice();
}
async function loadMembership() {
  if (!currentUser) {
    membershipActive = false;
    membershipAutoRenew = false;
    membershipStatusUnavailable = false;
    membershipVerificationRequired = false;
    $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
    return;
  }
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/anime-premium/membership", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 && payload.code === "email-not-verified") {
      membershipStatusUnavailable = false;
      membershipVerificationRequired = true;
      if (pricing) await updatePrice();
      else $("vap-checkout-status").textContent = "Verify your Vivid email address before subscribing.";
      return;
    }
    if (!response.ok) {
      membershipStatusUnavailable = true;
      if (pricing) await updatePrice();
      else $("vap-checkout-status").textContent = "Vivid could not verify your current membership. Reload and try again before paying.";
      return;
    }
    membershipStatusUnavailable = false;
    membershipVerificationRequired = false;
    const membership = payload.membership || {};
    membershipActive = membership.active === true;
    membershipAutoRenew = membership.autoRenew === true;
    $("vap-cancel-renewal").hidden = !membershipActive || !membership.canCancelAutoRenew;
    if (membershipActive) {
      $("vap-current-membership").hidden = false;
      $("vap-membership-state").textContent = membership.autoRenew ? "Your Premium membership is active and set to renew automatically." : "Your Premium membership is active.";
      $("vap-membership-period").textContent = "Access through " + (membership.currentPeriodEnd ? new Date(membership.currentPeriodEnd).toLocaleDateString() : "the current billing period") + " · " + (membership.autoRenew ? (membership.canCancelAutoRenew ? "Card auto-renewal is on" : "Card auto-renewal is on · contact support to cancel") : "Manual renewal");
      $("vap-account-status").textContent = "You are signed in with your Vivid account.";
    }
  } catch (error) {
    membershipStatusUnavailable = true;
    console.warn("Vivid Anime Premium membership status could not be loaded:", error);
    if (pricing) await updatePrice();
    else $("vap-checkout-status").textContent = "Vivid could not verify your current membership. Reload and try again before paying.";
  }
}
async function startCheckout() {
  if (membershipStatusUnavailable || membershipVerificationRequired) {
    $("vap-checkout-status").textContent = membershipVerificationRequired
      ? "Verify your Vivid email address before subscribing."
      : "Vivid must verify your current membership before another payment can be started.";
    return;
  }
  if (!pricing?.checkoutEnabled) { $("vap-checkout-status").textContent = "Secure checkout is not enabled in this environment yet."; return; }
  if (membershipActive && membershipAutoRenew) return;
  if (!currentUser) {
    window.location.href = "auth.html?returnTo=anime-premium-membership.html";
    return;
  }
  if (!selectedPaymentMethod) {
    $("vap-checkout-status").textContent = "Choose a supported payment method.";
    return;
  }
  const button = $("vap-checkout-button");
  button.disabled = true;
  button.textContent = "Preparing secure Paystack checkout…";
  $("vap-checkout-status").textContent = "";
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/anime-premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ country: selectedCountry, paymentMethod: selectedPaymentMethod })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 && payload.code === "email-not-verified") {
      membershipVerificationRequired = true;
      if (pricing) await updatePrice();
    }
    if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message || "Secure checkout could not be started.");
    $("vap-checkout-status").textContent = "Opening Paystack securely…";
    window.location.assign(payload.authorizationUrl);
  } catch (error) {
    await updatePrice();
    $("vap-checkout-status").textContent = error.message || "Checkout could not be started.";
  } finally {
    if (pricing) await updatePrice();
  }
}

async function cancelAutomaticRenewal() {
  if (!currentUser || !membershipAutoRenew) return;
  const button = $("vap-cancel-renewal");
  button.disabled = true;
  button.textContent = "Cancelling…";
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/anime-premium/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Automatic renewal could not be cancelled.");
    membershipAutoRenew = false;
    button.hidden = true;
    $("vap-membership-state").textContent = "Automatic renewal is cancelled. Your Premium access remains active until the current period ends.";
    $("vap-checkout-status").textContent = "Automatic renewal cancelled. You can renew manually before your access expires.";
    await updatePrice();
  } catch (error) {
    $("vap-checkout-status").textContent = error.message || "Could not cancel automatic renewal.";
    button.disabled = false;
    button.textContent = "Cancel automatic renewal";
  }
}

function bind() {
  $("vap-country").addEventListener("change", async event => {
    selectedCountry = event.target.value;
    localStorage.setItem("vivid:anime-premium-country", selectedCountry);
    selectedPaymentMethod = "";
    $("vap-checkout-status").textContent = "";
    await updatePrice();
  });
  document.querySelectorAll('input[name="vap-payment-method"]').forEach(input => input.addEventListener("change", () => {
    if (!input.disabled) {
      selectedPaymentMethod = input.value;
      $("vap-checkout-status").textContent = "";
      void updatePrice();
    }
  }));
  $("vap-checkout-button").addEventListener("click", startCheckout);
  $("vap-cancel-renewal").addEventListener("click", cancelAutomaticRenewal);
}
async function initAuth() {
  try {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]);
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    onAuthStateChanged(auth, async user => {
      currentUser = user && !user.isAnonymous ? user : null;
      if (currentUser) await loadMembership();
      else {
        membershipActive = false;
        membershipAutoRenew = false;
        membershipStatusUnavailable = false;
        membershipVerificationRequired = false;
        $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
      }
      if (pricing) await updatePrice();
    }, error => {
      console.warn("Vivid Anime Premium could not restore the account session:", error);
      currentUser = null;
      if (pricing) void updatePrice();
    });
  } catch (error) {
    console.warn("Vivid account services are unavailable on the membership page:", error);
    currentUser = null;
    $("vap-checkout-status").textContent = "Pricing is available, but Vivid sign-in could not be verified. Reload or sign in again before checkout.";
    if (pricing) await updatePrice();
  }
}
async function init() {
  bind();
  // Account and country services are optional enhancements. Neither should
  // prevent the server-owned price from rendering.
  void initAuth();
  void loadCountries().then(() => {
    if (pricing) return updatePrice();
  }).catch(error => console.warn("Premium country list unavailable; using the fallback list:", error));
  try { await loadPricing(); }
  catch (error) {
    $("vap-local-price").textContent = "Price unavailable";
    $("vap-price-note").textContent = error.message;
    $("vap-checkout-button").disabled = true;
    $("vap-checkout-status").textContent = error.message;
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
