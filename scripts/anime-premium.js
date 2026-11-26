const accountLink = document.querySelector("[data-vap-account]");
const primaryLink = document.querySelector("[data-vap-primary]");
const accountStatus = document.body?.dataset?.vividPage === "anime-premium"
  ? document.getElementById("vap-account-status")
  : null;
const currentRoute = window.location.pathname.split("/").pop();
const premiumRoutes = new Set([
  "anime-premium.html", "anime-premium-title.html", "anime-premium-watch.html",
  "anime-premium-library.html", "anime-premium-membership.html", "anime-premium-return.html"
]);
const returnDestination = premiumRoutes.has(currentRoute)
  ? currentRoute + window.location.search
  : "anime-premium.html";

function setSignedOut() {
  const login = "auth.html?returnTo=" + encodeURIComponent(returnDestination);
  if (accountLink) {
    accountLink.href = login;
    accountLink.textContent = "Sign in";
    accountLink.setAttribute("aria-label", "Sign in with your existing Vivid account");
  }
  if (primaryLink) {
    primaryLink.href = login;
    primaryLink.textContent = "Sign in to Vivid";
  }
  if (accountStatus) {
    accountStatus.textContent = "A Vivid account is required before you can subscribe. Sign in or create your free Vivid account to continue.";
  }
}

function setSignedIn(user) {
  const label = user.displayName || user.email || "your Vivid account";
  if (accountLink) {
    accountLink.href = "account.html";
    accountLink.textContent = "My account";
    accountLink.setAttribute("aria-label", "Open your Vivid account");
  }
  if (primaryLink) {
    primaryLink.href = "account.html";
    primaryLink.textContent = "Account connected";
  }
  if (accountStatus) {
    accountStatus.textContent = "Signed in as " + label + ". Your existing Vivid account will own your Anime Premium membership.";
  }
}

if (accountStatus) accountStatus.textContent = "Checking your Vivid account…";
if (accountLink) accountLink.setAttribute("aria-disabled", "true");

try {
  const [{ auth }, { onAuthStateChanged }] = await Promise.all([
    import("./firebase.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
  ]);
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  onAuthStateChanged(auth, user => {
    if (user && !user.isAnonymous) setSignedIn(user);
    else setSignedOut();
    if (accountLink) accountLink.removeAttribute("aria-disabled");
  }, error => {
    console.error("Vivid Anime Premium could not resolve the Vivid account session:", error);
    setSignedOut();
    if (accountStatus) accountStatus.textContent = "We couldn't confirm your Vivid session. Please sign in again before continuing.";
    if (accountLink) accountLink.removeAttribute("aria-disabled");
  });
} catch (error) {
  console.error("Vivid Anime Premium account initialization failed:", error);
  setSignedOut();
  if (accountStatus) accountStatus.textContent = "Vivid account services are temporarily unavailable. Please reload and try again.";
  if (accountLink) accountLink.removeAttribute("aria-disabled");
}
