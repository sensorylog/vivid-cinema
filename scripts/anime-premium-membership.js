import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

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
let selectedCountry = "GH";
let selectedPaymentMethod = "card";\nlet selectedPlanId = "monthly";\nconst PAGE_CHECKOUT_PLANS = { monthly: { amountMajor: 53.30 }, biannually: { amountMajor: 287.82 }, annually: { amountMajor: 511.68 } };
const rateCache = new Map();

function getCountry(code) { return countries.find(country => country.code === code) || FALLBACK_COUNTRIES[0]; }
function getCheckoutCurrency(countryCode) { return "GHS"; }
function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return amount.toFixed(2) + " " + currency; }
}
async function loadCountries() {
  try {
    const response = await fetch("https://restcountries.com/v3.1/all?fields=cca2,name,currencies", { cache: "force-cache" });
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
  const promise = fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(baseCurrency), { cache: "no-store" })
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
  const plan = PAGE_CHECKOUT_PLANS[selectedPlanId];
  $("vap-local-currency").textContent = localCurrency;
  $("vap-checkout-currency").textContent = checkoutCurrency;
  if (!plan) {
    $("vap-local-price").textContent = "Price unavailable";
    $("vap-price-note").textContent = "Vivid has not configured a checkout price for this region yet.";
    $("vap-checkout-button").disabled = true;
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
  selectedPaymentMethod = "card";
  const cardRadio = document.querySelector('input[name="vap-payment-method"][value="card"]');
  const mobileRadio = document.querySelector('input[name="vap-payment-method"][value="mobile_money"]');
  cardRadio.checked = true;
  cardRadio.disabled = false;
  mobileRadio.disabled = true;
  $("vap-card-method").setAttribute("aria-disabled", "false");
  $("vap-mobile-method").setAttribute("aria-disabled", "true");
  $("vap-method-note").textContent = "Use the same verified email address as your Vivid account on the Paystack page so your payment can be matched to your membership.";
  $("vap-checkout-button").disabled = !pricing.checkoutEnabled || (membershipActive && membershipAutoRenew) || !selectedPaymentMethod;
  $("vap-checkout-button").textContent = !pricing.checkoutEnabled ? "Checkout temporarily unavailable" : membershipActive ? (membershipAutoRenew ? "Membership active — auto-renew on" : "Renew manually →") : currentUser ? "Continue to secure checkout →" : "Sign in to subscribe →";
}
async function loadPricing() {
  const response = await fetch("/api/anime-premium/pricing", { cache: "no-store" });
  if (!response.ok) throw new Error("Premium pricing is temporarily unavailable.");
  pricing = await response.json();
  if (!pricing.ok || !pricing.plans || !Object.keys(pricing.plans).length) throw new Error("No Premium checkout currency is configured yet.");
  await updatePrice();
}
async function loadMembership() {
  if (!currentUser) {
    membershipActive = false;
    membershipAutoRenew = false;
    $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
    return;
  }
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/anime-premium/membership", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store"
    });
    if (response.status === 403) {
      $("vap-checkout-status").textContent = "Verify your Vivid email address before subscribing.";
      return;
    }
    if (!response.ok) return;
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
  } catch (error) {
    console.warn("Vivid Anime Premium membership status could not be loaded:", error);
  }
}
async function startCheckout() {
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
    const response = await fetch("/api/anime-premium/page-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      cache: "no-store",
      body: JSON.stringify({ planId: selectedPlanId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.paymentPageUrl) throw new Error(payload.message || "Paystack payment page could not be opened.");
    $("vap-checkout-status").textContent = "Opening your selected Paystack page. Use the same verified email as your Vivid account.";
    window.location.assign(payload.paymentPageUrl);
  } catch (error) {
    $("vap-checkout-status").textContent = error.message || "Checkout could not be started.";
    await updatePrice();
  } finally {
    button.disabled = !pricing.checkoutEnabled || (membershipActive && membershipAutoRenew) || !selectedPaymentMethod;
    button.textContent = !pricing.checkoutEnabled ? "Checkout temporarily unavailable" : membershipActive ? (membershipAutoRenew ? "Membership active — auto-renew on" : "Renew manually →") : currentUser ? "Continue to secure checkout →" : "Sign in to subscribe →";
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
  document.querySelectorAll("[data-vap-plan]").forEach(button => button.addEventListener("click", async () => {
    selectedPlanId = button.dataset.vapPlan;
    document.querySelectorAll("[data-vap-plan]").forEach(option => {
      const active = option === button;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-pressed", String(active));
    });
    await updatePrice();
  }));
  $("vap-country").addEventListener("change", async event => {
    selectedCountry = event.target.value;
    localStorage.setItem("vivid:anime-premium-country", selectedCountry);
    selectedPaymentMethod = "";
    await updatePrice();
  });
  document.querySelectorAll('input[name="vap-payment-method"]').forEach(input => input.addEventListener("change", () => {
    if (!input.disabled) {
      selectedPaymentMethod = input.value;
      void updatePrice();
    }
  }));
  $("vap-checkout-button").addEventListener("click", startCheckout);
  $("vap-cancel-renewal").addEventListener("click", cancelAutomaticRenewal);
}
onAuthStateChanged(auth, async user => {
  currentUser = user && !user.isAnonymous ? user : null;
  if (currentUser) await loadMembership();
  else {
    membershipActive = false;
    membershipAutoRenew = false;
    $("vap-account-status").innerHTML = 'Already subscribed? <a href="auth.html?returnTo=anime-premium-membership.html">Sign in with your Vivid account</a>.';
  }
  if (pricing) await updatePrice();
});
async function init() {
  bind();
  await loadCountries();
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
