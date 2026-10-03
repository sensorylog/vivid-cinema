import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getLocalLibrary, syncLibraryForUser } from "./library.js";\nimport { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

const statusEl = document.getElementById("account-status");
const emailEl = document.getElementById("user-email");
const nameEl = document.getElementById("user-name");
const providerEl = document.getElementById("user-provider");
const verificationEl = document.getElementById("user-verification");
const countryEl = document.getElementById("provider-country");
const autoplayEl = document.getElementById("autoplay-trailers");
const reducedMotionEl = document.getElementById("reduced-motion");
const saveButton = document.getElementById("save-btn");
const logoutButton = document.getElementById("logout-btn");\nconst syncButton = document.getElementById("sync-btn");\nconst syncDot = document.getElementById("sync-dot");\nconst syncLabel = document.getElementById("sync-label");\nconst syncDetail = document.getElementById("sync-detail");\nconst changePasswordButton = document.getElementById("change-password-btn");\nconst securityStatus = document.getElementById("security-status");
const counts = {
  favorites: document.getElementById("favorites-count"),
  watchLater: document.getElementById("watch-later-count"),
  history: document.getElementById("history-count")
};

const PROVIDER_COUNTRIES = [
  ["US", "United States"],
  ["GH", "Ghana"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["NG", "Nigeria"],
  ["ZA", "South Africa"],
  ["AU", "Australia"]
];

function providerLabel(user) {
  const provider = user.providerData?.[0]?.providerId || "password";
  return provider === "google.com" ? "Google" : provider === "password" ? "Email & password" : provider;
}

function setStatus(message, good = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = good ? "success" : "default";
}

function renderCounts(library) {
  Object.entries(counts).forEach(([key, element]) => {
    if (element) element.textContent = String((library[key] || []).length);
  });
}

function fillCountryOptions(selected) {
  if (!countryEl) return;
  countryEl.innerHTML = PROVIDER_COUNTRIES.map(([code, label]) =>
    '<option value="' + code + '">' + label + "</option>"
  ).join("");
  countryEl.value = selected || "US";
}

function loadLocalPreferences() {
  let providerCountry = "US";
  try {
    providerCountry = localStorage.getItem("vivid:provider-country") || "US";
  } catch {}
  return {
    providerCountry,
    autoplayTrailers: localStorage.getItem("vivid:autoplay-trailers") !== "false",
    reducedMotion: localStorage.getItem("vivid:reduced-motion") === "true"
  };
}

function saveLocalPreferences(preferences) {
  try {
    localStorage.setItem("vivid:provider-country", preferences.providerCountry);
    localStorage.setItem("vivid:autoplay-trailers", String(preferences.autoplayTrailers));
    localStorage.setItem("vivid:reduced-motion", String(preferences.reducedMotion));
  } catch {}
}

async function loadUser(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  const profile = snapshot.exists() ? snapshot.data() : {};
  const local = loadLocalPreferences();
  const preferences = { ...local, ...(profile.preferences || {}) };

  emailEl.value = user.email || "";
  nameEl.value = profile.displayName || user.displayName || "";
  providerEl.textContent = providerLabel(user);
  verificationEl.textContent = user.emailVerified ? "Verified" : "Verification required";
  verificationEl.dataset.state = user.emailVerified ? "success" : "warning";
  fillCountryOptions(preferences.providerCountry);
  autoplayEl.checked = preferences.autoplayTrailers !== false;
  reducedMotionEl.checked = preferences.reducedMotion === true;
  renderCounts(getLocalLibrary());

  saveButton.disabled = false;
  setStatus("Account ready.", true);
}

async function saveAccount() {
  const user = auth.currentUser;
  if (!user) return;

  const displayName = nameEl.value.trim();
  const preferences = {
    providerCountry: countryEl.value,
    autoplayTrailers: autoplayEl.checked,
    reducedMotion: reducedMotionEl.checked
  };

  saveButton.disabled = true;
  setStatus("Saving changes…");

  try {
    await updateProfile(user, { displayName });
    await setDoc(doc(db, "users", user.uid), {
      displayName,
      email: user.email || null,
      preferences,
      updatedAt: serverTimestamp()
    }, { merge: true });

    saveLocalPreferences(preferences);
    document.documentElement.dataset.vividReducedMotion = preferences.reducedMotion ? "true" : "false";
    setStatus("Changes saved.", true);
  } catch (error) {
    console.error("Vivid account save failed:", error);
    setStatus("Could not save changes. Please try again.");
  } finally {
    saveButton.disabled = false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    await loadUser(user);
  } catch (error) {
    console.error("Vivid account load failed:", error);
    const local = loadLocalPreferences();
    fillCountryOptions(local.providerCountry);
    autoplayEl.checked = local.autoplayTrailers;
    reducedMotionEl.checked = local.reducedMotion;
    renderCounts(getLocalLibrary());
    setStatus("Account loaded locally. Cloud preferences could not be reached.");
    saveButton.disabled = false;
  }
});

syncButton?.addEventListener("click", async () => {\n  const user=auth.currentUser;if(!user)return;\n  syncButton.disabled=true;setSyncStatus("Syncing…","Merging this device with your cloud library.","syncing");\n  try{const library=await syncLibraryForUser(user);renderCounts(library);setSyncStatus("Synced just now","Your likes, watch later list and history are up to date.","success");setStatus("Library synced.",true);}\n  catch(error){console.error(error);setSyncStatus("Sync paused","Your local library is still available on this device.","error");setStatus("Cloud sync could not be completed.");}\n  finally{syncButton.disabled=false;}\n});\n\nchangePasswordButton?.addEventListener("click", async () => {\n  const user=auth.currentUser;if(!user?.email)return;\n  changePasswordButton.disabled=true;\n  try{await sendPasswordResetEmail(auth,user.email);if(securityStatus)securityStatus.textContent="Password reset instructions sent to your email.";}\n  catch(error){if(securityStatus)securityStatus.textContent="Could not send the reset email. Please try again.";console.error(error);}\n  finally{changePasswordButton.disabled=false;}\n});\n\nsaveButton?.addEventListener("click", saveAccount);
logoutButton?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});
