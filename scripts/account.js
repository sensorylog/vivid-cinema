import { auth, db } from "./firebase.js?v=20261016-auth-runtime-audit1";
import { deleteUser, EmailAuthProvider, GoogleAuthProvider, onAuthStateChanged, reauthenticateWithCredential, reauthenticateWithPopup, sendPasswordResetEmail, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, deleteDoc, doc, getDocsFromServer, getDoc, serverTimestamp, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getLocalLibrary, syncLibraryForUser } from "./library.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("account-status");
const emailEl = $("user-email");
const nameEl = $("user-name");
const providerEl = $("user-provider");
const verificationEl = $("user-verification");
const avatarEl = $("account-avatar");
const profileSummaryEl = $("profile-summary");
const profileTitleEl = $("profile-title");
const accountTypeEl = $("account-type");
const createdEl = $("account-created");
const countryEl = $("provider-country");
const autoplayEl = $("autoplay-trailers");
const reducedMotionEl = $("reduced-motion");
const saveButton = $("save-btn");
const cancelButton = $("cancel-btn");
const logoutButton = $("logout-btn");
const syncButton = $("sync-btn");
const syncDot = $("sync-dot");
const syncLabel = $("sync-label");
const syncDetail = $("sync-detail");
const changePasswordButton = $("change-password-btn");
const securityStatus = $("security-status");
const deleteAccountButton = $("delete-account-btn");
const counts = {
  favorites: $("favorites-count"),
  watchLater: $("watch-later-count"),
  history: $("history-count")
};

const PROVIDER_COUNTRIES = [
  ["US", "United States"], ["GH", "Ghana"], ["GB", "United Kingdom"],
  ["CA", "Canada"], ["NG", "Nigeria"], ["ZA", "South Africa"],
  ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["BE", "Belgium"], ["CH", "Switzerland"], ["AT", "Austria"],
  ["IE", "Ireland"], ["PT", "Portugal"], ["SE", "Sweden"],
  ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
  ["PL", "Poland"], ["GR", "Greece"], ["TR", "Türkiye"],
  ["IN", "India"], ["PK", "Pakistan"], ["BD", "Bangladesh"],
  ["PH", "Philippines"], ["ID", "Indonesia"], ["MY", "Malaysia"],
  ["SG", "Singapore"], ["TH", "Thailand"], ["JP", "Japan"],
  ["KR", "South Korea"], ["CN", "China"], ["BR", "Brazil"],
  ["MX", "Mexico"], ["AR", "Argentina"], ["CL", "Chile"],
  ["CO", "Colombia"], ["EG", "Egypt"], ["KE", "Kenya"],
  ["UG", "Uganda"], ["TZ", "Tanzania"], ["RW", "Rwanda"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
  ["IL", "Israel"], ["NZ", "New Zealand"]
];

let initialValues = null;
let isSaving = false;
let currentUser = null;

function providerLabel(user) {
  const ids = [...new Set((user.providerData || []).map((item) => item.providerId))];
  if (ids.includes("google.com") && ids.includes("password")) return "Google + email";
  if (ids.includes("google.com")) return "Google";
  if (ids.includes("password")) return "Email & password";
  return ids[0] || "Account";
}

function setSyncStatus(label, detail, state = "idle") {
  if (syncLabel) syncLabel.textContent = label;
  if (syncDetail) syncDetail.textContent = detail;
  if (syncDot) syncDot.dataset.state = state;
}

function setStatus(message, state = "default") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function getFormValues() {
  return {
    displayName: nameEl?.value.trim() || "",
    providerCountry: countryEl?.value || "US",
    autoplayTrailers: autoplayEl?.checked !== false,
    reducedMotion: reducedMotionEl?.checked === true
  };
}

function valuesChanged() {
  if (!initialValues) return false;
  return JSON.stringify(getFormValues()) !== JSON.stringify(initialValues);
}

function refreshSaveState() {
  if (saveButton) saveButton.disabled = isSaving || !valuesChanged();
  if (cancelButton) cancelButton.disabled = isSaving || !valuesChanged();
}

function snapshotForm() {
  initialValues = getFormValues();
  refreshSaveState();
}

function renderCounts(library) {
  Object.entries(counts).forEach(([key, element]) => {
    if (element) element.textContent = String(Array.isArray(library?.[key]) ? library[key].length : 0);
  });
}

function renderAvatar(user, displayName) {
  if (!avatarEl) return;
  avatarEl.replaceChildren();
  const photoURL = user.photoURL || user.providerData?.find((provider) => provider.photoURL)?.photoURL;
  if (photoURL) {
    try {
      const url = new URL(photoURL);
      if (url.protocol === "https:") {
        const image = document.createElement("img");
        image.src = url.href;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.loading = "lazy";
        image.addEventListener("error", () => {
          image.remove();
          avatarEl.textContent = (displayName.trim().charAt(0) || "V").toUpperCase();
        }, { once: true });
        avatarEl.append(image);
        return;
      }
    } catch {}
  }
  avatarEl.textContent = (displayName.trim().charAt(0) || "V").toUpperCase();
}

function fillCountryOptions(selected) {
  if (!countryEl) return;
  const known = new Map(PROVIDER_COUNTRIES);
  if (selected && !known.has(selected)) known.set(selected, selected + " (saved region)");
  countryEl.replaceChildren();
  for (const [code, label] of known) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    countryEl.append(option);
  }
  countryEl.value = selected && known.has(selected) ? selected : "US";
}

function loadLocalPreferences() {
  const read = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  return {
    providerCountry: read("vivid:provider-country") || "US",
    autoplayTrailers: read("vivid:autoplay-trailers") !== "false",
    reducedMotion: read("vivid:reduced-motion") === "true"
  };
}

function saveLocalPreferences(preferences) {
  const failures = [];
  for (const [key, value] of [
    ["vivid:provider-country", preferences.providerCountry],
    ["vivid:autoplay-trailers", String(preferences.autoplayTrailers)],
    ["vivid:reduced-motion", String(preferences.reducedMotion)]
  ]) {
    try { localStorage.setItem(key, value); } catch { failures.push(key); }
  }
  return failures.length === 0;
}

function formatCreatedDate(user, profile) {
  const raw = profile.createdAt?.toDate?.() || (user.metadata?.creationTime ? new Date(user.metadata.creationTime) : null);
  if (!raw || Number.isNaN(raw.getTime())) return "On this device";
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(raw);
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(
      () => reject(Object.assign(new Error(message), { code: "vivid/timeout" })),
      ms
    ))
  ]);
}

function renderSignedInIdentity(user) {
  currentUser = user;
  const displayName = user.displayName || user.email?.split("@")[0] || "Vivid member";
  if (emailEl) emailEl.value = user.email || "";
  if (nameEl && !nameEl.value) nameEl.value = displayName;
  if (profileTitleEl) profileTitleEl.textContent = displayName;
  if (profileSummaryEl) profileSummaryEl.textContent = user.email || "Your personal cinema profile";
  if (accountTypeEl) accountTypeEl.textContent = providerLabel(user);
  if (providerEl) providerEl.textContent = providerLabel(user);
  if (verificationEl) {
    verificationEl.textContent = user.email ? (user.emailVerified ? "Email verified" : "Not verified") : "No email";
    verificationEl.dataset.state = user.emailVerified ? "success" : "warning";
  }
  if (createdEl) createdEl.textContent = formatCreatedDate(user, {});
  renderAvatar(user, displayName);
}

async function loadUser(user) {
  // Render Firebase Auth details immediately; Firestore preferences must never
  // block the visible identity or leave the page in an endless loading state.
  renderSignedInIdentity(user);
  setStatus("Loading your account details…");
  const snapshot = await withTimeout(
    getDoc(doc(db, "users", user.uid)),
    6500,
    "Your cloud profile took too long to respond."
  );
  let profile = snapshot.exists() ? snapshot.data() : {};
  if (!snapshot.exists()) {
    // Older Auth accounts may not have a Firestore profile yet. Create it on
    // first account visit instead of treating a missing document as "synced".
    profile = {
      displayName: (user.displayName || user.email?.split("@")[0] || "Vivid member").slice(0, 100),
      email: user.email || null,
      provider: (user.providerData || []).some((item) => item.providerId === "google.com") ? "google.com" : "password",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await withTimeout(
      setDoc(doc(db, "users", user.uid), profile, { merge: true }),
      6500,
      "Your cloud profile could not be created."
    );
  }
  const preferences = { ...loadLocalPreferences(), ...(profile.preferences || {}) };
  const displayName = profile.displayName || user.displayName || user.email?.split("@")[0] || "Vivid member";

  currentUser = user;
  if (emailEl) emailEl.value = user.email || "";
  if (nameEl) nameEl.value = displayName;
  if (profileTitleEl) profileTitleEl.textContent = displayName;
  if (profileSummaryEl) profileSummaryEl.textContent = user.email || "Your personal cinema profile";
  if (accountTypeEl) accountTypeEl.textContent = providerLabel(user);
  if (providerEl) providerEl.textContent = providerLabel(user);
  if (verificationEl) {
    verificationEl.textContent = user.email ? (user.emailVerified ? "Email verified" : "Not verified") : "No email";
    verificationEl.dataset.state = user.emailVerified ? "success" : "warning";
  }
  if (createdEl) createdEl.textContent = formatCreatedDate(user, profile);
  renderAvatar(user, displayName);
  fillCountryOptions(preferences.providerCountry);
  if (autoplayEl) autoplayEl.checked = preferences.autoplayTrailers !== false;
  if (reducedMotionEl) reducedMotionEl.checked = preferences.reducedMotion === true;
  document.documentElement.dataset.vividReducedMotion = preferences.reducedMotion ? "true" : "false";
  renderCounts(getLocalLibrary());
  snapshotForm();

  const hasPasswordProvider = (user.providerData || []).some((item) => item.providerId === "password");
  if (changePasswordButton) {
    changePasswordButton.disabled = !hasPasswordProvider;
    changePasswordButton.textContent = hasPasswordProvider ? "Send password reset" : "Managed by Google";
    if (securityStatus && !hasPasswordProvider) securityStatus.textContent = "This account uses Google sign-in. Manage its password with Google.";
  }
  setSyncStatus("Library on this device", "Your local counts are ready. Sync to verify cloud changes.", "idle");
  setStatus("Your profile is ready.", "success");
}

async function saveAccount() {
  const user = auth.currentUser;
  if (!user || isSaving) return;
  const values = getFormValues();
  if (values.displayName.length < 2) {
    setStatus("Display name must contain at least 2 characters.", "error");
    nameEl?.focus();
    return;
  }
  if (values.displayName.length > 80) {
    setStatus("Display name must be 80 characters or fewer.", "error");
    nameEl?.focus();
    return;
  }

  isSaving = true;
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Saving…"; }
  if (cancelButton) cancelButton.disabled = true;
  setStatus("Saving your profile and preferences…");

  const preferences = {
    providerCountry: values.providerCountry,
    autoplayTrailers: values.autoplayTrailers,
    reducedMotion: values.reducedMotion
  };
  let cloudSaved = false;
  let authNameSaved = false;
  try {
    await setDoc(doc(db, "users", user.uid), {
      displayName: values.displayName,
      email: user.email || null,
      provider: (user.providerData || []).some((item) => item.providerId === "google.com") ? "google.com" : "password",
      preferences,
      updatedAt: serverTimestamp(),
      ...(!user.metadata?.creationTime ? { createdAt: serverTimestamp() } : {})
    }, { merge: true });
    cloudSaved = true;

    try {
      await updateProfile(user, { displayName: values.displayName });
      authNameSaved = true;
    } catch (error) {
      console.error("Vivid Auth display name update failed after cloud profile save:", error);
    }

    const localSaved = saveLocalPreferences(preferences);
    document.documentElement.dataset.vividReducedMotion = preferences.reducedMotion ? "true" : "false";
    renderAvatar(user, values.displayName);
    if (profileTitleEl) profileTitleEl.textContent = values.displayName;
    if (profileSummaryEl) profileSummaryEl.textContent = user.email || "Your personal cinema profile";
    snapshotForm();

    if (authNameSaved && localSaved) {
      setStatus("Profile and preferences saved.", "success");
    } else if (!authNameSaved) {
      setStatus("Preferences saved. The sign-in profile name could not be updated; try saving again.", "error");
    } else {
      setStatus("Cloud profile saved. Browser storage is unavailable, so some preferences may not persist on this device.", "error");
    }
  } catch (error) {
    console.error("Vivid account save failed:", error);
    setStatus(cloudSaved
      ? "Some changes were saved, but the account update did not finish. Review your settings and try again."
      : "Could not save to your cloud profile. Your edits are still here; please try again.", "error");
  } finally {
    isSaving = false;
    if (saveButton) saveButton.textContent = "Save changes";
    refreshSaveState();
  }
}

function cancelEdits() {
  if (!initialValues || isSaving) return;
  if (nameEl) nameEl.value = initialValues.displayName;
  fillCountryOptions(initialValues.providerCountry);
  if (autoplayEl) autoplayEl.checked = initialValues.autoplayTrailers;
  if (reducedMotionEl) reducedMotionEl.checked = initialValues.reducedMotion;
  setStatus("Unsaved changes discarded.");
  refreshSaveState();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  // Keep the account usable while Firestore restores or fetches profile data.
  renderSignedInIdentity(user);
  setSyncStatus("Library on this device", "Your account is signed in; cloud details are loading.", "idle");
  setStatus("Signed in. Loading your account details…");
  try {
    await loadUser(user);
  } catch (error) {
    console.error("Vivid account load failed:", error);
    currentUser = user;
    const local = loadLocalPreferences();
    fillCountryOptions(local.providerCountry);
    if (nameEl) nameEl.value = user.displayName || user.email?.split("@")[0] || "Vivid member";
    if (profileTitleEl) profileTitleEl.textContent = nameEl?.value || "Vivid member";
    if (profileSummaryEl) profileSummaryEl.textContent = user.email || "Your personal cinema profile";
    if (emailEl) emailEl.value = user.email || "";
    if (providerEl) providerEl.textContent = providerLabel(user);
    if (accountTypeEl) accountTypeEl.textContent = providerLabel(user);
    if (verificationEl) {
      verificationEl.textContent = user.emailVerified ? "Email verified" : "Not verified";
      verificationEl.dataset.state = user.emailVerified ? "success" : "warning";
    }
    renderAvatar(user, nameEl?.value || "Vivid member");
    if (autoplayEl) autoplayEl.checked = local.autoplayTrailers;
    if (reducedMotionEl) reducedMotionEl.checked = local.reducedMotion;
    if (createdEl) createdEl.textContent = formatCreatedDate(user, {});
    renderCounts(getLocalLibrary());
    snapshotForm();
    setSyncStatus("Cloud profile unavailable", "Your local library is available; cloud profile could not be loaded.", "error");
    setStatus("Loaded a local fallback. Cloud preferences could not be reached.", "error");
  }
});

for (const control of [nameEl, countryEl, autoplayEl, reducedMotionEl]) {
  control?.addEventListener("input", refreshSaveState);
  control?.addEventListener("change", refreshSaveState);
}
saveButton?.addEventListener("click", saveAccount);
cancelButton?.addEventListener("click", cancelEdits);

syncButton?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || !syncButton || syncButton.disabled) return;
  syncButton.disabled = true;
  setSyncStatus("Syncing library…", "Checking this device against your cloud library.", "syncing");
  try {
    const library = await syncLibraryForUser(user);
    renderCounts(library);
    setSyncStatus("Synced just now", "Your likes, Watch Later and history are up to date.", "success");
    setStatus("Library sync completed.", "success");
  } catch (error) {
    console.error("Vivid library sync failed:", error);
    setSyncStatus("Sync paused", "Your local library is still available. Check your connection and retry.", "error");
    setStatus("Cloud sync could not be completed.", "error");
  } finally {
    syncButton.disabled = false;
  }
});

changePasswordButton?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user?.email || !(user.providerData || []).some((item) => item.providerId === "password")) return;
  changePasswordButton.disabled = true;
  if (securityStatus) securityStatus.textContent = "Sending password reset instructions…";
  try {
    await sendPasswordResetEmail(auth, user.email);
    if (securityStatus) securityStatus.textContent = "Password reset instructions sent. Check your inbox.";
  } catch (error) {
    console.error("Vivid password reset request failed:", error);
    if (securityStatus) securityStatus.textContent = "Could not send the reset email. Check your connection and try again.";
  } finally {
    changePasswordButton.disabled = false;
  }
});


const ACCOUNT_PRIVATE_COLLECTIONS = [
  "pushSubscriptions", "releaseAlerts", "releaseStates", "cinemaReminders",
  "favorites", "watchLater", "history", "progress", "libraryTombstones",
  "feedback", "events", "taste", "achievements", "blockedUsers", "following", "followedTopics"
];

async function reauthenticateForDeletion(user) {
  const providerIds = (user.providerData || []).map((item) => item.providerId);
  if (providerIds.includes("password") && user.email) {
    const password = window.prompt("Enter your password to confirm account deletion.");
    if (password === null) throw new Error("Account deletion cancelled.");
    if (!password) throw new Error("Enter your password to continue.");
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return;
  }
  if (providerIds.includes("google.com")) {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    return;
  }
  throw new Error("This sign-in method cannot be reauthenticated here. Sign out, sign in again, then retry.");
}

async function deleteOwnedDocuments(uid, collectionName) {
  const snapshot = await withTimeout(
    getDocsFromServer(collection(db, "users", uid, collectionName)),
    12000,
    "Could not read your " + collectionName + " records for deletion."
  );
  const documents = snapshot.docs;
  for (let offset = 0; offset < documents.length; offset += 400) {
    const batch = writeBatch(db);
    documents.slice(offset, offset + 400).forEach((item) => batch.delete(item.ref));
    await withTimeout(batch.commit(), 12000, "Could not delete your " + collectionName + " records.");
  }
}

async function permanentlyDeleteAccount() {
  const user = auth.currentUser;
  if (!user || deleteAccountButton?.disabled) return;
  const confirmed = window.confirm(
    "Permanently delete your Vivid Cinema account and its private profile, preferences, and saved library data? This cannot be undone."
  );
  if (!confirmed) return;

  if (deleteAccountButton) {
    deleteAccountButton.disabled = true;
    deleteAccountButton.textContent = "Confirming identity…";
  }
  setStatus("Confirming your identity before account deletion…");
  if (securityStatus) securityStatus.textContent = "Your account will be deleted only after security verification.";

  try {
    await reauthenticateForDeletion(user);
    if (deleteAccountButton) deleteAccountButton.textContent = "Deleting private data…";
    setStatus("Deleting your private account data…");

    for (const collectionName of ACCOUNT_PRIVATE_COLLECTIONS) {
      await deleteOwnedDocuments(user.uid, collectionName);
    }
    await withTimeout(deleteDoc(doc(db, "users", user.uid)), 12000, "Could not delete your profile document.");

    // Clear this browser's Vivid-owned data after the server-side private data is gone.
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let index = storage.length - 1; index >= 0; index--) {
          const key = storage.key(index);
          if (key && key.startsWith("vivid:")) storage.removeItem(key);
        }
      } catch (storageError) {
        console.warn("Vivid could not clear all local account data:", storageError);
      }
    }

    if (deleteAccountButton) deleteAccountButton.textContent = "Deleting account…";
    await withTimeout(deleteUser(user), 15000, "Firebase account deletion timed out.");
    currentUser = null;
    window.location.replace("login.html?accountDeleted=1");
  } catch (error) {
    console.error("Vivid account deletion failed:", error);
    const code = error?.code || "";
    let message = error?.message || "Account deletion failed.";
    if (code === "auth/requires-recent-login") {
      message = "For security, sign in again and retry deleting your account.";
    } else if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
      message = "Google verification did not finish. Allow the sign-in window, then try again.";
    } else if (code === "permission-denied" || code === "firestore/permission-denied") {
      message = "Firestore denied access while deleting private data. Your account has not been deleted; contact support.";
    } else if (message.includes("timed out")) {
      message = "Deletion timed out before it could finish. Your account may still exist; retry after checking your connection.";
    } else if (message === "Account deletion cancelled.") {
      message = "Account deletion cancelled.";
    } else if (!message || message === error?.code) {
      message = "Could not delete the account. Check your connection and try again.";
    }
    setStatus(message, "error");
    if (securityStatus) securityStatus.textContent = "Deletion did not complete. Your account may still be active; review the message above before retrying.";
    if (deleteAccountButton) {
      deleteAccountButton.disabled = false;
      deleteAccountButton.textContent = "Delete account permanently";
    }
  }
}

deleteAccountButton?.addEventListener("click", permanentlyDeleteAccount);


logoutButton?.addEventListener("click", async () => {
  if (!logoutButton) return;
  logoutButton.disabled = true;
  const originalLabel = logoutButton.textContent;
  logoutButton.textContent = "Signing out…";
  setStatus("Signing you out securely…");
  try {
    await withTimeout(signOut(auth), 10000, "Sign out timed out.");
    currentUser = null;
    window.location.replace("login.html");
  } catch (error) {
    console.error("Vivid sign out failed:", error);
    setStatus("Could not log out. Check your connection and try again.", "error");
    logoutButton.disabled = false;
    logoutButton.textContent = originalLabel || "Log out";
  }
});
