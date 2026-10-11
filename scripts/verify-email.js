import { auth } from "./firebase.js";
import { applyActionCode } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const title = document.getElementById("verification-title");
const message = document.getElementById("verification-message");
const error = document.getElementById("verification-error");
const action = document.getElementById("verification-action");
const help = document.getElementById("verification-help");
const mark = document.getElementById("verification-mark");

function showSuccess() {
  title.textContent = "Email verified successfully!";
  message.textContent = "You’re all set. Your Vivid Cinema account is ready.";
  mark.textContent = "✓";
  mark.style.color = "#7ee787";
  action.style.display = "block";
  action.textContent = "Continue to Log In";
  action.href = "login.html";
  help.textContent = "For your security, sign in with your email and password to start your session.";
}
function showFailure(text) {
  title.textContent = "We couldn’t verify that email";
  message.textContent = text;
  mark.textContent = "!";
  mark.style.color = "#ff6b6b";
  action.style.display = "block";
  action.textContent = "Go to Log In";
  action.href = "login.html";
  help.textContent = "If the link has expired or was already used, sign in and request a new verification email.";
}

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const code = params.get("oobCode");

if (mode !== "verifyEmail" || !code) {
  showFailure("This verification link is incomplete. Open the latest verification email and tap its verification button.");
} else {
  try {
    await applyActionCode(auth, code);
    showSuccess();
  } catch (err) {
    console.error("Email verification action failed:", err);
    if (err?.code === "auth/expired-action-code" || err?.code === "auth/invalid-action-code") {
      showFailure("This link may have expired or already been used. Try signing in, or request a fresh verification email.");
    } else if (err?.code === "auth/network-request-failed") {
      showFailure("Check your internet connection and open the verification link again.");
    } else {
      showFailure("The link could not be confirmed. Please try again or request a fresh verification email.");
    }
  }
}
