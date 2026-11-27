import { ANIME_PREMIUM_COUNTRIES } from "./anime-premium-countries.js";
const $ = id => document.getElementById(id);
const FALLBACK_COUNTRIES = ANIME_PREMIUM_COUNTRIES;
const PAGE_CHECKOUT_PLANS = {
  monthly: { amountMajor: 53.30, label: "1 month", period: "month" },
  biannually: { amountMajor: 287.82, label: "6 months", period: "6 months" },
  annually: { amountMajor: 511.68, label: "1 year", period: "year" }
};
let pricing = { checkoutEnabled: false, defaultCurrency: "GHS" };
let countries = FALLBACK_COUNTRIES;
let currentUser = null;
let accountEmailVerified = false;
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
  button.disabled = !pricing.checkoutEnabled || (membershipActive && membershipAutoRenew) || !authReady || Boolean(currentUser && !accountEmailVerified);
  if (!pricing.checkoutEnabled && pricing.checkoutMessage) $("vap-checkout-status").textContent = pricing.checkoutMessage;
  button.textContent = !pricing.checkoutEnabled ? "Checkout temporarily unavailable"
    : membershipActive && membershipAutoRenew ? "Membership active — auto-renew on"
    : !authReady ? "Checking your Vivid account…"
    : currentUser && !accountEmailVerified ? "Verify your email to subscribe"
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
  countries = ANIME_PREMIUM_COUNTRIES;
  selectedCountry = countries.some(country => country.code === saved) ? saved : "GH";
  const fragment = document.createDocumentFragment();
  countries.forEach(country => {
    const option = document.createElement("option");
    option.value = country.code;
    option.textContent = country.name + (country.currency ? " (" + country.currency + ")" : "");
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  select.value = selectedCountry;
}
async function getExchangeRate(currency) {
  const now = Date.now();
  if (rateCache && rateCache.currency === currency && now - rateCacheAt < 6 * 60 * 60 * 1000) return rateCache;
  const response = await withTimeout(
    fetch("/api/anime-premium/exchange-rate?currency=" + encodeURIComponent(currency), { cache: "no-store" }),
    9000,
    "Daily exchange-rate request timed out."
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !Number.isFinite(Number(payload.rate)) || Number(payload.rate) <= 0) {
    throw new Error(payload.message || "A published GHS/" + currency + " reference rate is unavailable.");
  }
  rateCache = { currency, rate: Number(payload.rate), date: String(payload.date || "") };
  rateCacheAt = now;
  return rateCache;
}
async function updatePrice() {
  const requestId = ++priceRequestId;
  const plan = PAGE_CHECKOUT_PLANS[selectedPlanId];
  const country = getCountry(selectedCountry);
  const localCurrency = country.currency || "";
  $("vap-local-currency").textContent = localCurrency || "Not applicable";
  $("vap-checkout-currency").textContent = "GHS · Ghanaian Cedi";
  $("vap-local-price").textContent = localCurrency === "GHS" ? formatMoney(plan.amountMajor, "GHS") : localCurrency ? "Calculating…" : "Not available";
  $("vap-price-note").textContent = localCurrency ? "Retrieving the latest published reference rate…" : "This territory has no separately assigned local currency. Paystack checkout remains in Ghanaian Cedis (GHS).";
  renderPlan();
  if (localCurrency === "GHS") {
    $("vap-price-note").textContent = "Paystack checkout charge: " + formatMoney(plan.amountMajor, "GHS") + ".";
  } else if (localCurrency) {
    try {
      const quote = await getExchangeRate(localCurrency);
      if (requestId !== priceRequestId) return;
      const rate = quote.rate;
      if (Number.isFinite(rate) && rate > 0) {
        $("vap-local-price").textContent = "≈ " + formatMoney(plan.amountMajor * rate, localCurrency);
        $("vap-price-note").textContent = "Reference rate: 1 GHS = " + rate.toFixed(6) + " " + localCurrency + (quote.date ? " · Rate date: " + quote.date : "") + ". Source: " + quote.source + ", daily indicative reference rates. Paystack charges " + formatMoney(plan.amountMajor, "GHS") + "; your bank/card provider sets the final converted charge and may add fees.";
      } else {
        $("vap-local-price").textContent = formatMoney(plan.amountMajor, "GHS");
        $("vap-price-note").textContent = "Local estimate temporarily unavailable. Paystack charges " + formatMoney(plan.amountMajor, "GHS") + " in Ghanaian Cedis (GHS); your bank/card provider determines any conversion and fees.";
      }
    } catch (error) {
      console.warn("Vivid FX reference-rate lookup failed:", error);
      if (requestId !== priceRequestId) return;
      $("vap-local-price").textContent = formatMoney(plan.amountMajor, "GHS");
      $("vap-price-note").textContent = "Local estimate temporarily unavailable. Paystack charges " + formatMoney(plan.amountMajor, "GHS") + " in Ghanaian Cedis (GHS); your bank/card provider determines any conversion and fees.";
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
  const accountLabel = currentUser.displayName || currentUser.email || "your Vivid account";
  $("vap-account-status").textContent = "Signed in as " + accountLabel + ". Your existing Vivid account will own your Anime Premium membership.";
  const token = await currentUser.getIdToken(true);
  const response = await withTimeout(fetch("/api/anime-premium/membership", {
    headers: { Authorization: "Bearer " + token }, cache: "no-store"
  }), 6500, "Membership status request timed out.");
  if (response.status === 403) {
    accountEmailVerified = false;
    setCheckoutState();
    $("vap-checkout-status").textContent = "Verify your Vivid email address before subscribing.";
    $("vap-account-status").textContent = "Signed in as " + accountLabel + ". Verify your email to continue to Anime Premium.";
    return;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.message || "Membership status could not be checked.";
    throw new Error(response.status === 404
      ? "The Premium membership service route is unavailable in this app build. Update Vivid Cinema and retry."
      : detail);
  }
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
    const token = await currentUser.getIdToken(true);
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
async function applyAuthenticatedUser(user) {
  currentUser = user && !user.isAnonymous ? user : null;
  accountEmailVerified = Boolean(currentUser && currentUser.emailVerified === true);
  authReady = true;
  if (currentUser) {
    const label = currentUser.displayName || currentUser.email || "your Vivid account";
    $("vap-account-status").textContent = "Signed in as " + label + ". Your existing Vivid account will own your Anime Premium membership.";
  } else {
    $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
  }
  try { await loadMembership(); }
  catch (error) {
    console.warn("Premium membership lookup failed:", error);
    $("vap-checkout-status").textContent = "Your Vivid account is signed in, but membership status could not be checked. You can retry shortly.";
  }
  setCheckoutState();
}
async function initialiseAuth() {
  // Reuse the shared shell's already-restored Firebase session. This avoids
  // starting a second auth bootstrap on the membership page.
  if (window.vividAuthResolved === true) {
    await applyAuthenticatedUser(window.vividAuthUser || null);
    return;
  }
  const shellUser = await new Promise(resolve => {
    let settled = false;
    const finish = user => {
      if (settled) return;
      settled = true;
      window.removeEventListener("vivid:auth-ready", onReady);
      window.clearTimeout(timer);
      resolve(user);
    };
    const onReady = event => finish(event.detail || null);
    window.addEventListener("vivid:auth-ready", onReady, { once: true });
    const timer = window.setTimeout(() => finish(undefined), 3500);
    if (window.vividAuthResolved === true) finish(window.vividAuthUser || null);
  });
  if (shellUser !== undefined) {
    await applyAuthenticatedUser(shellUser);
    return;
  }
  // Fallback for pages where the shared shell cannot initialise.
  try {
    const [{ auth }, { onAuthStateChanged }] = await withTimeout(Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]), 9000, "Vivid sign-in initialisation timed out.");
    if (typeof auth.authStateReady === "function") await withTimeout(auth.authStateReady(), 9000, "Restoring your saved Vivid sign-in timed out.");
    await applyAuthenticatedUser(auth.currentUser || null);
    onAuthStateChanged(auth, user => { void applyAuthenticatedUser(user); }, error => {
      console.warn("Vivid authentication state unavailable:", error);
      $("vap-checkout-status").textContent = "We could not verify your Vivid sign-in. Refresh the page or sign in again.";
    });
  } catch (error) {
    console.error("Vivid authentication module could not initialise:", error);
    authReady = true;
    setCheckoutState();
    $("vap-checkout-status").textContent = "Vivid account verification is temporarily unavailable. Your saved sign-in may still be active; refresh and try again.";
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
    if (!$("vap-country").options.length) {
      countries = FALLBACK_COUNTRIES;
      selectedCountry = countries.some(country => country.code === selectedCountry) ? selectedCountry : "GH";
      const select = $("vap-country");
      select.replaceChildren(...countries.map(country => {
        const option = document.createElement("option");
        option.value = country.code;
        option.textContent = country.name + (country.currency ? " (" + country.currency + ")" : "");
        return option;
      }));
      select.value = selectedCountry;
    }
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
