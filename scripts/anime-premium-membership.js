const $ = id => document.getElementById(id);
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
const PAGE_CHECKOUT_PLANS = {
  monthly: { amountMajor: 53.30, label: "1 month", period: "month" },
  biannually: { amountMajor: 287.82, label: "6 months", period: "6 months" },
  annually: { amountMajor: 511.68, label: "1 year", period: "year" }
};
let pricing = { checkoutEnabled: false, defaultCurrency: "GHS" };
let countries = FALLBACK_COUNTRIES;
let currentUser = null;
let authReady = false;
let membershipActive = false;
let membershipAutoRenew = false;
let selectedCountry = "GH";
let selectedPlanId = "monthly";
let priceRequestId = 0;
let rateCache = null;
let rateCacheAt = 0;
const withTimeout = async (promise, ms, message) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally { window.clearTimeout(timer); }
};
function getCountry(code) { return countries.find(country => country.code === code) || FALLBACK_COUNTRIES[0]; }
function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return Number(amount).toFixed(2) + " " + currency; }
}
function setCheckoutState() {
  const button = $("vap-checkout-button");
  if (!button) return;
  button.disabled = !pricing.checkoutEnabled || (membershipActive && membershipAutoRenew) || !authReady;
  button.textContent = !pricing.checkoutEnabled ? "Checkout temporarily unavailable"
    : membershipActive && membershipAutoRenew ? "Membership active — auto-renew on"
    : !authReady ? "Checking your Vivid account…"
    : currentUser ? "Continue to secure checkout →" : "Sign in to subscribe →";
}
function renderPlan() {
  const plan = PAGE_CHECKOUT_PLANS[selectedPlanId];
  if ($("vap-price-period")) $("vap-price-period").textContent = "/ " + plan.period;
  const pill = document.querySelector(".vap-plan-pill");
  if (pill) pill.textContent = plan.label.toUpperCase() + " MEMBERSHIP";
  if ($("vap-card-description")) $("vap-card-description").textContent = "Secure Paystack card billing for " + plan.label.toLowerCase() + ".";
  document.querySelectorAll("[data-vap-plan]").forEach(button => {
    const active = button.dataset.vapPlan === selectedPlanId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
async function loadCountries() {
  const select = $("vap-country");
  if (!select) throw new Error("Country selector is missing from the membership page.");
  const saved = (() => { try { return localStorage.getItem("vivid:anime-premium-country") || "GH"; } catch { return "GH"; } })();
  // Render a usable selector immediately; remote country metadata can improve it afterwards.
  countries = FALLBACK_COUNTRIES;
  const render = () => {
    select.innerHTML = countries.map(country => {
      const option = document.createElement("option");
      option.value = country.code;
      option.textContent = country.name;
      return option;
    }).map(option => option.outerHTML).join("");
    select.value = countries.some(country => country.code === selectedCountry) ? selectedCountry : "GH";
  };
  selectedCountry = countries.some(country => country.code === saved) ? saved : "GH";
  render();
  try {
    const response = await withTimeout(fetch("https://restcountries.com/v3.1/all?fields=cca2,name,currencies", { cache: "force-cache" }), 4000, "Country list request timed out.");
    if (!response.ok) throw new Error("Country list unavailable");
    const data = await response.json();
    const parsed = data.map(country => ({
      code: String(country.cca2 || "").toUpperCase(),
      name: country.name?.common || country.cca2,
      currency: Object.keys(country.currencies || {})[0] || ""
    })).filter(country => /^[A-Z]{2}$/.test(country.code) && country.name && country.currency);
    if (parsed.length > 180) {
      countries = parsed.sort((a, b) => a.name.localeCompare(b.name));
      if (!countries.some(country => country.code === selectedCountry)) selectedCountry = "GH";
      render();
    }
  } catch (error) {
    console.warn("Using the built-in country list:", error);
  }
  select.value = selectedCountry;
}
async function getExchangeRates(baseCurrency) {
  // Frankfurter v2 blended middle/reference rates; not a card issuer settlement quote.
  const now = Date.now();
  if (rateCache && now - rateCacheAt < 15 * 60 * 1000) return rateCache;
  const response = await withTimeout(fetch("https://api.frankfurter.dev/v2/rates?base=" + encodeURIComponent(baseCurrency), { cache: "no-store" }), 7000, "Reference-rate request timed out.");
  if (!response.ok) throw new Error("Reference exchange rates are unavailable (" + response.status + ").");
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("The exchange-rate provider returned no rates.");
  const rates = {};
  let date = "";
  for (const row of rows) {
    const rate = Number(row.rate);
    if (row.base === baseCurrency && row.quote && Number.isFinite(rate) && rate > 0) rates[row.quote] = rate;
    if (row.date && (!date || row.date > date)) date = row.date;
  }
  if (!Object.keys(rates).length) throw new Error("No supported reference rates were returned.");
  rateCache = { rates, date };
  rateCacheAt = now;
  return rateCache;
}
async function updatePrice() {
  const requestId = ++priceRequestId;
  const plan = PAGE_CHECKOUT_PLANS[selectedPlanId];
  const country = getCountry(selectedCountry);
  const localCurrency = country.currency || "GHS";
  $("vap-local-currency").textContent = localCurrency;
  $("vap-checkout-currency").textContent = "GHS · Ghanaian Cedi";
  $("vap-local-price").textContent = localCurrency === "GHS" ? formatMoney(plan.amountMajor, "GHS") : "Calculating…";
  $("vap-price-note").textContent = "Paystack always charges the fixed Ghana Cedi plan price. Local currency is an estimate.";
  renderPlan();
  if (localCurrency === "GHS") {
    $("vap-price-note").textContent = "Your selected country uses Ghanaian Cedis. Paystack will charge " + formatMoney(plan.amountMajor, "GHS") + ".";
  } else {
    const quote = await getExchangeRates("GHS");
    if (requestId !== priceRequestId) return;
    const rate = quote.rates?.[localCurrency];
    if (Number.isFinite(rate) && rate > 0) {
      $("vap-local-price").textContent = "≈ " + formatMoney(plan.amountMajor * rate, localCurrency);
      $("vap-price-note").textContent = "Reference rate: 1 GHS = " + rate.toFixed(6) + " " + localCurrency + (quote.date ? " · Rate date: " + quote.date : "") + ". Source: Frankfurter blended central-bank reference rates. Paystack charges " + formatMoney(plan.amountMajor, "GHS") + "; your bank/card provider sets the final converted charge and may add fees.";
    } else {
      $("vap-local-price").textContent = "Rate unavailable";
      $("vap-price-note").textContent = "We could not retrieve a current published GHS/" + localCurrency + " reference rate. We will not display an invented conversion. Paystack checkout charges " + formatMoney(plan.amountMajor, "GHS") + "; your bank/card provider determines the converted amount.";
    }
  }
  if (requestId !== priceRequestId) return;
  $("vap-method-note").textContent = "Checkout is completed securely on Paystack. Use the same verified email address as your Vivid account so your payment can be matched to your membership.";
  setCheckoutState();
}
async function loadPricing() {
  const response = await withTimeout(fetch("/api/anime-premium/pricing", { cache: "no-store" }), 6500, "Pricing service timed out.");
  if (!response.ok) throw new Error("Premium pricing is temporarily unavailable (" + response.status + ").");
  const payload = await response.json();
  if (!payload.ok || !payload.plans || !Object.keys(payload.plans).length) throw new Error(payload.message || "Premium pricing is not configured.");
  pricing = payload;
}
async function loadMembership() {
  if (!currentUser) {
    membershipActive = false;
    membershipAutoRenew = false;
    $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
    return;
  }
  const token = await currentUser.getIdToken();
  const response = await withTimeout(fetch("/api/anime-premium/membership", {
    headers: { Authorization: "Bearer " + token }, cache: "no-store"
  }), 6500, "Membership status request timed out.");
  if (response.status === 403) {
    $("vap-checkout-status").textContent = "Verify your Vivid email address before subscribing.";
    return;
  }
  if (!response.ok) throw new Error("Membership status could not be checked.");
  const payload = await response.json();
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
}
async function startCheckout() {
  if (!pricing.checkoutEnabled) { $("vap-checkout-status").textContent = "Secure checkout is temporarily unavailable. Please try again shortly."; return; }
  if (!authReady) { $("vap-checkout-status").textContent = "Vivid account status is still loading. Please try again."; return; }
  if (membershipActive && membershipAutoRenew) return;
  if (!currentUser) { window.location.href = "auth.html?returnTo=anime-premium-membership.html"; return; }
  const button = $("vap-checkout-button");
  button.disabled = true;
  button.textContent = "Preparing Paystack checkout…";
  $("vap-checkout-status").textContent = "";
  try {
    const token = await currentUser.getIdToken();
    const response = await withTimeout(fetch("/api/anime-premium/page-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      cache: "no-store",
      body: JSON.stringify({ planId: selectedPlanId })
    }), 9000, "Checkout request timed out. Please try again.");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.paymentPageUrl) throw new Error(payload.message || "Paystack payment page could not be opened.");
    window.location.assign(payload.paymentPageUrl);
    return;
  } catch (error) {
    $("vap-checkout-status").textContent = error.message || "Checkout could not be started.";
  } finally { setCheckoutState(); }
}
async function cancelAutomaticRenewal() {
  if (!currentUser || !membershipAutoRenew) return;
  const button = $("vap-cancel-renewal");
  button.disabled = true;
  button.textContent = "Cancelling…";
  try {
    const token = await currentUser.getIdToken();
    const response = await withTimeout(fetch("/api/anime-premium/cancel", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      cache: "no-store", body: JSON.stringify({})
    }), 9000, "Cancellation request timed out.");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Automatic renewal could not be cancelled.");
    membershipAutoRenew = false;
    button.hidden = true;
    $("vap-membership-state").textContent = "Automatic renewal is cancelled. Your Premium access remains active until the current period ends.";
    $("vap-checkout-status").textContent = "Automatic renewal cancelled. You can renew manually before your access expires.";
  } catch (error) {
    $("vap-checkout-status").textContent = error.message || "Could not cancel automatic renewal.";
    button.disabled = false;
    button.textContent = "Cancel automatic renewal";
  }
  setCheckoutState();
}
function bind() {
  document.querySelectorAll("[data-vap-plan]").forEach(button => button.addEventListener("click", () => {
    selectedPlanId = PAGE_CHECKOUT_PLANS[button.dataset.vapPlan] ? button.dataset.vapPlan : "monthly";
    void updatePrice();
  }));
  $("vap-country").addEventListener("change", event => {
    selectedCountry = event.target.value;
    try { localStorage.setItem("vivid:anime-premium-country", selectedCountry); } catch {}
    void updatePrice();
  });
  $("vap-checkout-button").addEventListener("click", startCheckout);
  $("vap-cancel-renewal").addEventListener("click", cancelAutomaticRenewal);
}
async function initialiseAuth() {
  try {
    const [{ auth }, { onAuthStateChanged }] = await withTimeout(Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]), 9000, "Vivid sign-in initialisation timed out.");
    if (typeof auth.authStateReady === "function") await withTimeout(auth.authStateReady(), 9000, "Restoring your saved Vivid sign-in timed out.");
    currentUser = auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : null;
    onAuthStateChanged(auth, async user => {
      currentUser = user && !user.isAnonymous ? user : null;
      authReady = true;
      try { await loadMembership(); }
      catch (error) { console.warn("Premium membership lookup failed:", error); }
      setCheckoutState();
      if (!currentUser) $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
    }, error => {
      console.warn("Vivid authentication state unavailable:", error);
      authReady = true;
      setCheckoutState();
      $("vap-checkout-status").textContent = "We could not verify your Vivid sign-in. Refresh the page or sign in again.";
    });
  } catch (error) {
    console.error("Vivid authentication module could not initialise:", error);
    authReady = true;
    setCheckoutState();
    $("vap-checkout-status").textContent = "Vivid sign-in could not be loaded. Refresh the page and try again.";
  }
}
async function init() {
  bind();
  renderPlan();
  $("vap-local-price").textContent = formatMoney(PAGE_CHECKOUT_PLANS.monthly.amountMajor, "GHS");
  $("vap-price-note").textContent = "Loading the selected country's currency estimate…";
  $("vap-checkout-button").textContent = "Checking checkout availability…";
  const countriesTask = loadCountries().then(() => updatePrice()).catch(error => {
    console.error("Country selector initialisation failed:", error);
    $("vap-price-note").textContent = "Country information could not be loaded. The Paystack charge remains in Ghanaian Cedis (GHS).";
  });
  const pricingTask = loadPricing().then(() => updatePrice()).catch(error => {
    console.error("Premium pricing initialisation failed:", error);
    pricing = { checkoutEnabled: false, defaultCurrency: "GHS" };
    $("vap-price-note").textContent = error.message + " The displayed GHS amount is the configured plan reference price.";
    $("vap-checkout-status").textContent = error.message;
    setCheckoutState();
  });
  void initialiseAuth();
  await Promise.allSettled([countriesTask, pricingTask]);
  if ($("vap-local-price").textContent === "Calculating…") $("vap-local-price").textContent = formatMoney(PAGE_CHECKOUT_PLANS[selectedPlanId].amountMajor, "GHS");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
