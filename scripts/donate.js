const PAYSTACK_PUBLIC_KEY = "pk_live_d43279760e5f3ea84aed449e8026da10fab2f1ad";

const CURRENCIES = {
  GHS: { symbol: "₵", presets: [5, 10, 20, 50], min: 0.10 }
};

const form = document.getElementById("donation-form");
const email = document.getElementById("donation-email");
const amount = document.getElementById("donation-amount");
const currency = document.getElementById("donation-currency");
const symbol = document.getElementById("currency-symbol");
const presets = document.getElementById("donation-presets");
const status = document.getElementById("donate-status");
const submit = document.getElementById("donate-submit");
const submitText = document.getElementById("donate-submit-text");

function config() {
  return CURRENCIES[currency.value] || CURRENCIES.GHS;
}

function renderCurrency() {
  const c = config();
  symbol.textContent = c.symbol;
  amount.min = String(c.min);
  amount.placeholder = Number(c.presets[1]).toFixed(2);
  presets.innerHTML = c.presets.map(value =>
    '<button type="button" class="donate-preset" data-amount="' + value + '">' +
    c.symbol + Number(value).toLocaleString() + '</button>'
  ).join("");
  presets.querySelectorAll(".donate-preset").forEach(button => {
    button.addEventListener("click", () => {
      amount.value = button.dataset.amount;
      presets.querySelectorAll(".donate-preset").forEach(x => x.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });
  });
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = "donate-status" + (kind ? " is-" + kind : "");
}

function setBusy(busy) {
  submit.disabled = busy;
  submit.setAttribute("aria-busy", busy ? "true" : "false");
  submitText.textContent = busy ? "Opening Paystack…" : "Support Vivid";
}

currency.addEventListener("change", renderCurrency);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const emailValue = email.value.trim();
  const value = Number(amount.value);
  const c = config();

  if (!emailValue || !email.checkValidity()) {
    email.focus();
    setStatus("Please enter a valid email address.", "error");
    return;
  }

  if (!Number.isFinite(value) || value < c.min) {
    amount.focus();
    setStatus("Please enter at least " + c.symbol + Number(c.min).toLocaleString() + ".", "error");
    return;
  }

  if (!window.PaystackPop) {
    setStatus("Paystack could not load. Check your connection and try again.", "error");
    return;
  }

  setBusy(true);
  setStatus("Preparing secure checkout…");

  try {
    const popup = new PaystackPop();
    const transaction = popup.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email: emailValue,
      amount: Math.round(value * 100),
      currency: currency.value,
      channels: ["card", "bank_transfer", "mobile_money", "apple_pay", "google_pay"],
      metadata: {
        purpose: "Vivid Cinema voluntary donation"
      },
      onSuccess: (response) => {
        setBusy(false);
        const reference = response && response.reference ? response.reference : "";
        window.location.assign("donation-success.html" + (reference ? "?reference=" + encodeURIComponent(reference) : ""));
      },
      onCancel: () => {
        setBusy(false);
        setStatus("Checkout closed. No contribution was made.", "info");
      }
    });
    void transaction;
  } catch (error) {
    console.error("Paystack checkout error:", error);
    setBusy(false);
    setStatus("We couldn't open Paystack checkout. Please try again.", "error");
  }
});

renderCurrency();