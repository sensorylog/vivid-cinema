import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const errorEl = document.getElementById("error-msg") || document.getElementById("login-error-msg");
const resetLink = document.getElementById("reset-password");

function showMessage(text, good = false) {
  if (!errorEl) return;
  errorEl.textContent = text;
  errorEl.style.color = good ? "#7ee787" : "#ff6b6b";
}

function friendlyError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again."
  };
  return messages[error?.code] || "Something went wrong. Please try again.";
}

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("username")?.value.trim() || "";
  const email = document.getElementById("email")?.value.trim() || "";
  const password = document.getElementById("password")?.value || "";
  const button = signupForm.querySelector("button[type=submit]");

  if (password.length < 6) {
    showMessage("Password must be at least 6 characters.");
    return;
  }

  button.disabled = true;
  showMessage("Creating your account…", true);

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "users", credential.user.uid), {
      displayName: name,
      email: credential.user.email,
      createdAt: serverTimestamp()
    }, { merge: true });
    window.location.href = "home.html";
  } catch (error) {
    console.error(error);
    showMessage(friendlyError(error));
    button.disabled = false;
  }
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email")?.value.trim() || "";
  const password = document.getElementById("login-password")?.value || "";
  const button = loginForm.querySelector("button[type=submit]");

  button.disabled = true;
  showMessage("Signing in…", true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "home.html";
  } catch (error) {
    console.error(error);
    showMessage(friendlyError(error));
    button.disabled = false;
  }
});

resetLink?.addEventListener("click", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email")?.value.trim() || "";
  if (!email) {
    showMessage("Enter your email first, then choose Forgot password.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Password reset email sent.", true);
  } catch (error) {
    console.error(error);
    showMessage(friendlyError(error));
  }
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    await signOut(auth);
    window.location.href = "login.html";
  });
});
