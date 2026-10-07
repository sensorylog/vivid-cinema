import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { getLocalLibrary, syncLibraryForUser } from "./library.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const statusEl = document.getElementById("account-status");
const emailEl = document.getElementById("user-email");
const nameEl = document.getElementById("user-name");
const providerEl = document.getElementById("user-provider");
const verificationEl = document.getElementById("user-verification");
const avatarEl = document.getElementById("account-avatar");
const profileSummaryEl = document.getElementById("profile-summary");
const accountTypeEl = document.getElementById("account-type");
const countryEl = document.getElementById("provider-country");
const autoplayEl = document.getElementById("autoplay-trailers");
const reducedMotionEl = document.getElementById("reduced-motion");
const saveButton = document.getElementById("save-btn");
const logoutButton = document.getElementById("logout-btn");
const syncButton = document.getElementById("sync-btn");
const syncDot = document.getElementById("sync-dot");
const syncLabel = document.getElementById("sync-label");
const syncDetail = document.getElementById("sync-detail");
const changePasswordButton = document.getElementById("change-password-btn");
const securityStatus = document.getElementById("security-status");
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

function setSyncStatus(label, detail, state="idle"){if(syncLabel)syncLabel.textContent=label;if(syncDetail)syncDetail.textContent=detail;if(syncDot)syncDot.dataset.state=state;}

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
  const displayName = profile.displayName || user.displayName || user.email?.split("@")[0] || "Vivid member";
  if (avatarEl) avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || "V";
  if (profileSummaryEl) profileSummaryEl.textContent = user.email || "Your Vivid profile";
  if (accountTypeEl) accountTypeEl.textContent = providerLabel(user);
  nameEl.value = displayName;
  providerEl.textContent = providerLabel(user);
  verificationEl.textContent = user.emailVerified ? "Verified" : "Verification required";
  verificationEl.dataset.state = user.emailVerified ? "success" : "warning";
  fillCountryOptions(preferences.providerCountry);
  autoplayEl.checked = preferences.autoplayTrailers !== false;
  reducedMotionEl.checked = preferences.reducedMotion === true;
  renderCounts(getLocalLibrary());

  saveButton.disabled = false;
  setSyncStatus("Cloud library connected","Your likes, watch later list and history are synced.","success");
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

syncButton?.addEventListener("click", async () => {
  const user=auth.currentUser;if(!user)return;
  syncButton.disabled=true;setSyncStatus("Syncing…","Merging this device with your cloud library.","syncing");
  try{const library=await syncLibraryForUser(user);renderCounts(library);setSyncStatus("Synced just now","Your likes, watch later list and history are up to date.","success");setStatus("Library synced.",true);}
  catch(error){console.error(error);setSyncStatus("Sync paused","Your local library is still available on this device.","error");setStatus("Cloud sync could not be completed.");}
  finally{syncButton.disabled=false;}
});

changePasswordButton?.addEventListener("click", async () => {
  const user=auth.currentUser;if(!user?.email)return;
  changePasswordButton.disabled=true;
  try{await sendPasswordResetEmail(auth,user.email);if(securityStatus)securityStatus.textContent="Password reset instructions sent to your email.";}
  catch(error){if(securityStatus)securityStatus.textContent="Could not send the reset email. Please try again.";console.error(error);}
  finally{changePasswordButton.disabled=false;}
});

saveButton?.addEventListener("click", saveAccount);
logoutButton?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});
