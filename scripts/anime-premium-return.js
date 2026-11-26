
const $ = id => document.getElementById(id);
function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => window.clearTimeout(timer));
}
const reference = new URLSearchParams(window.location.search).get("reference") || "";
let currentUser = null;
let checks = 0;

function setState(icon, title, copy) {
  $("vap-return-icon").innerHTML = '<i class="bi ' + icon + '" aria-hidden="true"></i>';
  $("vap-return-title").textContent = title;
  $("vap-return-copy").textContent = copy;
}
async function checkMembership() {
  if (!currentUser) {
    setState("bi-person-lock", "Sign in to check your membership", "Use the same Vivid account that started the Paystack checkout. Payment return alone never activates Premium access.");
    $("vap-return-refresh").textContent = "Sign in to Vivid";
    $("vap-return-refresh").onclick = () => { window.location.href = "auth.html?returnTo=anime-premium-membership.html"; };
    return;
  }
  $("vap-return-refresh").disabled = true;
  $("vap-return-refresh").textContent = "Checking…";
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/anime-premium/membership", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 403) {
      setState("bi-envelope-exclamation", "Verify your Vivid email", "Your Vivid account email must be verified before membership can be activated.");
      $("vap-return-refresh").textContent = "Check again";
      return;
    }
    if (!response.ok) throw new Error("Membership status is temporarily unavailable.");
    const payload = await response.json();
    const membership = payload.membership || {};
    if (membership.active === true) {
      setState("bi-check-circle-fill", "Your Anime Premium membership is active", "Payment verification is complete. Your Vivid account now has Premium access through " + (membership.currentPeriodEnd ? new Date(membership.currentPeriodEnd).toLocaleDateString() : "the current billing period") + ".");
      $("vap-return-refresh").textContent = "Explore Premium";
      $("vap-return-refresh").onclick = () => { window.location.href = "anime-premium.html"; };
      return;
    }
    checks++;
    setState("bi-hourglass-split", "Payment confirmation is pending", reference
      ? "Paystack returned your payment reference, but Vivid has not yet received a verified membership event. Wait a moment and check again. Do not submit another payment."
      : "No payment reference was returned. Check your membership status again or contact Vivid support if you completed a payment.");
    $("vap-return-refresh").textContent = "Check membership status";
    if (checks < 5 && reference) window.setTimeout(() => { void checkMembership(); }, 6000);
  } catch (error) {
    setState("bi-exclamation-circle", "We couldn’t confirm your membership yet", error.message || "Please try again.");
    $("vap-return-refresh").textContent = "Try again";
  } finally {
    $("vap-return-refresh").disabled = false;
  }
}
$("vap-return-reference").textContent = reference ? "Payment reference · …" + reference.slice(-8) : "No payment reference was returned.";
$("vap-return-refresh").addEventListener("click", () => { void checkMembership(); });
async function initAuth() {
  try {
    const [{ auth }, { onAuthStateChanged }] = await withTimeout(Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]), 10000, "Vivid account services timed out.");
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    currentUser = auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : null;
    onAuthStateChanged(auth, user => {
      currentUser = user && !user.isAnonymous ? user : null;
      void checkMembership();
    }, () => {
      currentUser = null;
      void checkMembership();
    });
  } catch (error) {
    console.warn("Vivid Anime Premium return could not restore the account session:", error);
    currentUser = null;
    void checkMembership();
  }
}
void initAuth();
