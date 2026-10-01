import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

const authLink = document.getElementById("auth-link");
const userDropdown = document.getElementById("user-dropdown");
const userEmail = document.getElementById("user-email");
const logoutLink = document.getElementById("logout-link");

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.dispatchEvent(new CustomEvent("vivid:auth-ready", { detail: user }));
    if (authLink) {
      authLink.style.display = "";
      authLink.textContent = "Account";
      authLink.href = "account.html";
      authLink.setAttribute("aria-label", "Open account");
    }
    if (userDropdown) userDropdown.style.display = "";
    if (userEmail) userEmail.textContent = user.email || user.displayName || "Account";
  } else {
    if (authLink) {
      authLink.style.display = "";
      authLink.textContent = "Sign in";
      authLink.href = "auth.html";
      authLink.removeAttribute("aria-label");
    }
    if (userDropdown) userDropdown.style.display = "none";
  }
});

logoutLink?.addEventListener("click", async (event) => {
  event.preventDefault();
  await signOut(auth);
  window.location.href = "login.html";
});
