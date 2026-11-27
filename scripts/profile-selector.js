import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { clearActiveProfileId, ensureOwnerProfile, initializeProfileFoundation, getActiveProfileId, setActiveProfileId } from "./profiles.js";
import { normalizeAvatarUrl } from "./profile-schema.js";
import { fetchProfiles, createProfile, updateProfile, deleteProfile, compressProfileImage, verifyProfilePin, setProfilePin, removeProfilePin, resetProfilePin, PROFILE_AVATARS, MAX_PROFILES } from "./profile-manager.js";

const $ = id => document.getElementById(id);
const grid = $("profile-grid");
const status = $("profile-status");
const dialog = $("profile-editor");
const form = $("profile-form");
const nameInput = $("profile-name");
const gallery = $("avatar-gallery");
const editorStatus = $("editor-status");
const saveButton = $("profile-save");
const deleteButton = $("profile-delete");
const photoInput = $("profile-photo");
const photoPreview = $("profile-photo-preview");
let user = null;
let profiles = [];
let editingId = null;
let selectedAvatar = "aurora";
let selectedAvatarData = "";
let selectedAvatarUrl = "";
let selectedAvatarSource = "collection";
let manageMode = false;
let saving = false;
let pendingProfile = null;
let switchingProfile = false;
let pinSaving = false;

const avatarVisuals = {
  aurora:["bi-stars","linear-gradient(145deg,#536b9e,#18233e)"],
  ember:["bi-fire","linear-gradient(145deg,#a85a42,#391b25)"],
  nebula:["bi-moon-stars","linear-gradient(145deg,#7459a8,#211b46)"],
  eclipse:["bi-circle-half","linear-gradient(145deg,#657080,#151a28)"],
  nova:["bi-sun","linear-gradient(145deg,#c28b52,#523328)"],
  prism:["bi-gem","linear-gradient(145deg,#528c9b,#26365f)"],
  orbit:["bi-globe2","linear-gradient(145deg,#4c7e9a,#182c4d)"],
  titan:["bi-shield-shaded","linear-gradient(145deg,#66748a,#222b3b)"],
  ripple:["bi-water","linear-gradient(145deg,#4d92a0,#153d50)"],
  halo:["bi-brightness-high","linear-gradient(145deg,#b28c58,#443321)"],
  flux:["bi-lightning-charge","linear-gradient(145deg,#8a63b0,#31204c)"],
  onyx:["bi-eye","linear-gradient(145deg,#626575,#171923)"],
  solstice:["bi-flower1","linear-gradient(145deg,#b17a79,#4b293f)"],
  comet:["bi-rocket-takeoff","linear-gradient(145deg,#6688b7,#263052)"],
  vortex:["bi-tornado","linear-gradient(145deg,#637d91,#253241)"],
  lumen:["bi-lightbulb","linear-gradient(145deg,#b4a46a,#49422a)"]
};
const destination = () => {
  let stored = "";
  try {
    stored = sessionStorage.getItem("vivid:profile-return-to:v1") || "";
    sessionStorage.removeItem("vivid:profile-return-to:v1");
  } catch {}
  const raw = stored || new URLSearchParams(location.search).get("returnTo") || "home.html";
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html") ||
      ["/profiles.html","/auth.html","/login.html","/account.html"].includes(url.pathname)) return "home.html";
    return url.pathname.replace(/^\//,"") + url.search + url.hash;
  } catch { return "home.html"; }
};
function say(message, error = false) {
  status.textContent = message;
  status.dataset.state = error ? "error" : "info";
}
function avatarNode(profile, large = false) {
  const [icon, background] = avatarVisuals[profile.avatarId] || avatarVisuals.aurora;
  const wrapper = document.createElement("span");
  wrapper.className = "profile-avatar";
  wrapper.style.background = background;
  if (profile.avatarData || profile.avatarUrl) {
    const image = document.createElement("img");
    image.src = profile.avatarData || profile.avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      const glyph = document.createElement("i");
      glyph.className = "bi " + icon;
      wrapper.append(glyph);
    }, { once:true });
    wrapper.append(image);
  } else {
    const glyph = document.createElement("i");
    glyph.className = "bi " + icon;
    wrapper.append(glyph);
  }
  return wrapper;
}
function renderProfiles() {
  grid.replaceChildren();
  grid.classList.toggle("is-managing", manageMode);
  for (const profile of profiles) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "profile-card";
    card.setAttribute("aria-label", (manageMode ? "Edit " : "Choose ") + profile.name);
    const avatar = avatarNode(profile);
    if (manageMode) {
      const edit = document.createElement("span");
      edit.className = "profile-card-edit";
      edit.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i>';
      avatar.append(edit);
    }
    const name = document.createElement("span");
    name.className = "profile-card-name";
    name.textContent = profile.name;
    if (profile.hasPin) {
      const lock = document.createElement("span");
      lock.className = "profile-card-lock";
      lock.innerHTML = '<i class="bi bi-lock-fill" aria-hidden="true"></i>';
      avatar.append(lock);
    }
    const meta = document.createElement("span");
    meta.className = "profile-card-meta";
    meta.textContent = profile.isOwner ? "Account owner" : profile.hasPin ? "PIN protected" : "Vivid profile";
    card.append(avatar,name,meta);
    card.addEventListener("click", () => manageMode ? openEditor(profile) : chooseProfile(profile));
    grid.append(card);
  }
  if (profiles.length < MAX_PROFILES) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "profile-card profile-add";
    add.setAttribute("aria-label","Add profile");
    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    const icon = document.createElement("i");
    icon.className = "bi bi-plus-lg";
    avatar.append(icon);
    const label = document.createElement("span");
    label.className = "profile-card-name";
    label.textContent = "Add profile";
    const meta = document.createElement("span");
    meta.className = "profile-card-meta";
    meta.textContent = "Create a new space";
    add.append(avatar,label,meta);
    add.addEventListener("click", () => openEditor());
    grid.append(add);
  }
  $("profile-count").textContent = profiles.length + " of " + MAX_PROFILES + " profiles";
}
function renderGallery() {
  gallery.replaceChildren();
  for (const avatar of PROFILE_AVATARS) {
    const [icon, background] = avatarVisuals[avatar.id] || avatarVisuals.aurora;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-choice";
    button.style.setProperty("--avatar-bg",background);
    button.setAttribute("role","radio");
    button.setAttribute("aria-checked",String(selectedAvatarSource === "collection" && selectedAvatar === avatar.id));
    button.setAttribute("aria-label",avatar.label);
    button.innerHTML = '<i class="bi ' + icon + '" aria-hidden="true"></i>';
    button.addEventListener("click",() => {
      selectedAvatar = avatar.id;
      selectedAvatarData = "";
      selectedAvatarUrl = "";
      selectedAvatarSource = "collection";
      photoPreview.hidden = true;
      renderGallery();
    });
    gallery.append(button);
  }
}
function openEditor(profile = null) {
  editingId = profile?.id || null;
  selectedAvatar = profile?.avatarId || "aurora";
  selectedAvatarData = profile?.avatarData || "";
  selectedAvatarUrl = profile?.avatarUrl || "";
  selectedAvatarSource = profile?.avatarSource || (selectedAvatarData ? "upload" : selectedAvatarUrl ? "google" : "collection");
  nameInput.value = profile?.name || "";
  editorStatus.textContent = "";
  deleteButton.hidden = !profile || profile.isOwner;
  $("profile-pin-status").textContent = profile?.hasPin ? "PIN enabled" : "No profile PIN";
  $("profile-pin-manage").textContent = profile?.hasPin ? "Change PIN" : "Set PIN";
  $("profile-pin-manage").hidden = !profile;
  photoInput.value = "";
  photoPreview.hidden = !selectedAvatarData;
  if (selectedAvatarData || (selectedAvatarSource === "google" && selectedAvatarUrl)) {
    photoPreview.replaceChildren();
    const img = document.createElement("img"); img.src = selectedAvatarData || selectedAvatarUrl; img.alt = "";
    const label = document.createElement("span"); label.textContent = selectedAvatarData ? "Custom photo selected" : "Google photo selected";
    photoPreview.append(img,label);
    photoPreview.hidden = false;
  }
  const googlePhoto = normalizeAvatarUrl(user?.photoURL || user?.providerData?.find(item => item.providerId === "google.com")?.photoURL || "");
  $("profile-use-google").hidden = !googlePhoto;
  $("editor-title").textContent = profile ? "Edit profile" : "Create a profile";
  saveButton.textContent = profile ? "Save changes" : "Create profile";
  renderGallery();
  dialog.showModal();
  nameInput.focus();
}
async function finishProfileOpen(profile, customToken = "") {
  if (customToken) {
    switchingProfile = true;
    try {
      const credential = await signInWithCustomToken(auth, customToken);
      user = credential.user;
    } finally {
      switchingProfile = false;
    }
  }
  setActiveProfileId(user.uid, profile.id);
  location.replace(destination());
}
async function chooseProfile(profile) {
  if (profile.hasPin) {
    pendingProfile = profile;
    $("profile-pin-input").value = "";
    $("profile-pin-status-message").textContent = "";
    $("profile-pin-description").textContent = "Enter the four-digit PIN to open " + profile.name + ".";
    $("profile-pin-dialog").showModal();
    $("profile-pin-input").focus();
    return;
  }
  try {
    say("Opening " + profile.name + "…");
    await finishProfileOpen(profile);
  } catch (error) { say(error.message || "Could not open this profile.",true); }
}
async function refreshProfiles() {
  await ensureOwnerProfile(user);
  let result = await fetchProfiles();
  if (!result.migrationComplete) {
    await initializeProfileFoundation(user);
    result = await fetchProfiles();
  }
  profiles = result.profiles;
  if (!profiles.length) throw new Error("No profiles are available for this Vivid account.");
  renderProfiles();
  say("Choose a profile to continue.");
}
$("profile-signout").addEventListener("click",async() => {
  const button = $("profile-signout");
  button.disabled = true;
  try { sessionStorage.removeItem("vivid:profile-return-to:v1"); await signOut(auth); location.replace("login.html"); }
  catch(error) { button.disabled = false; say(error.message || "Could not sign out. Please try again.",true); }
});
$("manage-toggle").addEventListener("click",() => {
  manageMode = !manageMode;
  $("manage-toggle").textContent = manageMode ? "Done" : "Manage profiles";
  $("profile-heading").textContent = manageMode ? "Manage profiles" : "Who's watching?";
  $("profile-subheading").textContent = manageMode ? "Edit names and avatars, or remove a profile." : "Choose your space. Your cinema journey stays yours.";
  renderProfiles();
});
$("profile-use-google").addEventListener("click",() => {
  const photo = normalizeAvatarUrl(user?.photoURL || user?.providerData?.find(item => item.providerId === "google.com")?.photoURL || "");
  if (!photo) return;
  selectedAvatarData = "";
  selectedAvatarUrl = photo;
  selectedAvatarSource = "google";
  photoPreview.replaceChildren();
  const img = document.createElement("img"); img.src = photo; img.alt = "";
  const label = document.createElement("span"); label.textContent = "Google account photo selected";
  photoPreview.append(img,label);
  photoPreview.hidden = false;
  renderGallery();
});

const pinDialog = $("profile-pin-dialog");
const pinForm = $("profile-pin-form");
const pinSettingsDialog = $("profile-pin-settings");
const pinSettingsForm = $("profile-pin-settings-form");
pinForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (pinSaving || !pendingProfile) return;
  const pin = $("profile-pin-input").value.trim();
  if (!/^\d{4}$/.test(pin)) {
    $("profile-pin-status-message").textContent = "Enter all four digits.";
    $("profile-pin-input").focus();
    return;
  }
  pinSaving = true;
  $("profile-pin-unlock").disabled = true;
  $("profile-pin-status-message").textContent = "Verifying PIN…";
  try {
    const result = await verifyProfilePin(pendingProfile.id, pin);
    const profile = pendingProfile;
    pinDialog.close();
    await finishProfileOpen(profile, result.customToken);
  } catch (error) {
    const wait = error.retryAfterMs > 0 ? " Try again in " + Math.ceil(error.retryAfterMs / 60000) + " minute(s)." : "";
    $("profile-pin-status-message").textContent = (error.message || "Could not verify this PIN.") + wait;
    $("profile-pin-input").value = "";
    $("profile-pin-input").focus();
  } finally {
    pinSaving = false;
    $("profile-pin-unlock").disabled = false;
  }
});
function closePinDialog() {
  pinDialog.close();
  pendingProfile = null;
}
$("profile-pin-close").addEventListener("click", closePinDialog);
$("profile-pin-cancel").addEventListener("click", closePinDialog);
$("profile-pin-forgot").addEventListener("click", async () => {
  if (!pendingProfile) return;
  try {
    sessionStorage.setItem("vivid:profile-pin-reset:v1", pendingProfile.id);
    sessionStorage.removeItem("vivid:profile-return-to:v1");
    await signOut(auth);
    location.replace("login.html");
  } catch (error) {
    $("profile-pin-status-message").textContent = error.message || "Could not start PIN recovery.";
  }
});
$("profile-pin-manage").addEventListener("click", () => {
  const profile = profiles.find(item => item.id === editingId);
  if (!profile) return;
  $("profile-pin-settings-title").textContent = profile.hasPin ? "Change profile PIN" : "Set a profile PIN";
  $("profile-current-pin-row").hidden = !profile.hasPin;
  $("profile-pin-remove").hidden = !profile.hasPin;
  $("profile-current-pin").value = "";
  $("profile-new-pin").value = "";
  $("profile-confirm-pin").value = "";
  $("profile-pin-settings-status").textContent = "";
  pinSettingsDialog.showModal();
  $("profile-new-pin").focus();
});
pinSettingsForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (pinSaving || !editingId) return;
  const profile = profiles.find(item => item.id === editingId);
  const pin = $("profile-new-pin").value.trim();
  const confirm = $("profile-confirm-pin").value.trim();
  const currentPin = $("profile-current-pin").value.trim();
  if (!/^\d{4}$/.test(pin) || pin !== confirm) {
    $("profile-pin-settings-status").textContent = pin !== confirm ? "The PIN entries do not match." : "Enter a four-digit PIN.";
    return;
  }
  if (profile?.hasPin && !/^\d{4}$/.test(currentPin)) {
    $("profile-pin-settings-status").textContent = "Enter the current four-digit PIN first.";
    return;
  }
  pinSaving = true;
  $("profile-pin-settings-save").disabled = true;
  $("profile-pin-settings-status").textContent = "Saving profile security…";
  try {
    const openSession = getActiveProfileId(user.uid) === editingId;
    const result = await setProfilePin(editingId, pin, currentPin, openSession);
    if (result.customToken) {
      switchingProfile = true;
      try { user = (await signInWithCustomToken(auth, result.customToken)).user; }
      finally { switchingProfile = false; }
    }
    await refreshProfiles();
    const updated = profiles.find(item => item.id === editingId);
    $("profile-pin-status").textContent = updated?.hasPin ? "PIN enabled" : "No profile PIN";
    $("profile-pin-manage").textContent = updated?.hasPin ? "Change PIN" : "Set PIN";
    pinSettingsDialog.close();
    $("profile-pin-settings-status").textContent = "";
  } catch (error) {
    $("profile-pin-settings-status").textContent = error.message || "Could not save this PIN.";
  } finally {
    pinSaving = false;
    $("profile-pin-settings-save").disabled = false;
  }
});
$("profile-pin-remove").addEventListener("click", async () => {
  if (pinSaving || !editingId) return;
  const currentPin = $("profile-current-pin").value.trim();
  if (!/^\d{4}$/.test(currentPin)) {
    $("profile-pin-settings-status").textContent = "Enter the current four-digit PIN to remove it.";
    return;
  }
  pinSaving = true;
  $("profile-pin-remove").disabled = true;
  $("profile-pin-settings-status").textContent = "Removing profile PIN…";
  try {
    await removeProfilePin(editingId, currentPin);
    await refreshProfiles();
    $("profile-pin-status").textContent = "No profile PIN";
    $("profile-pin-manage").textContent = "Set PIN";
    pinSettingsDialog.close();
  } catch (error) {
    $("profile-pin-settings-status").textContent = error.message || "Could not remove this PIN.";
  } finally {
    pinSaving = false;
    $("profile-pin-remove").disabled = false;
  }
});
$("profile-pin-settings-close").addEventListener("click", () => pinSettingsDialog.close());
$("profile-pin-settings-cancel").addEventListener("click", () => pinSettingsDialog.close());
$("editor-close").addEventListener("click",() => dialog.close());
$("profile-cancel").addEventListener("click",() => dialog.close());
dialog.addEventListener("click",event => { if(event.target === dialog) dialog.close(); });
photoInput.addEventListener("change",async() => {
  const file = photoInput.files?.[0];
  if (!file) return;
  try {
    selectedAvatarData = await compressProfileImage(file);
    selectedAvatarUrl = "";
    selectedAvatarSource = "upload";
    photoPreview.replaceChildren();
    const img = document.createElement("img"); img.src = selectedAvatarData; img.alt = "";
    const label = document.createElement("span"); label.textContent = "Custom photo ready";
    photoPreview.append(img,label);
    photoPreview.hidden = false;
    editorStatus.textContent = "";
  } catch(error) { editorStatus.textContent = error.message; photoInput.value = ""; }
});
form.addEventListener("submit",async event => {
  event.preventDefault();
  if (saving) return;
  const name = nameInput.value.trim();
  if (!name || name.length > 48) { editorStatus.textContent = "Enter a profile name between 1 and 48 characters."; nameInput.focus(); return; }
  saving = true; saveButton.disabled = true; editorStatus.textContent = "Saving profile…";
  try {
    const payload = { name, avatarId: selectedAvatar, avatarData: selectedAvatarData, avatarUrl: selectedAvatarUrl, avatarSource: selectedAvatarSource };
    if (editingId) await updateProfile(editingId,payload);
    else await createProfile(payload);
    await refreshProfiles();
    dialog.close();
  } catch(error) { editorStatus.textContent = error.message || "Could not save this profile."; }
  finally { saving = false; saveButton.disabled = false; }
});
deleteButton.addEventListener("click",async() => {
  if (!editingId || saving) return;
  const profile = profiles.find(item => item.id === editingId);
  if (!profile || profile.isOwner) return;
  if (!window.confirm("Delete " + profile.name + "? Its profile library and history will also be permanently deleted.")) return;
  saving = true; deleteButton.disabled = true; editorStatus.textContent = "Deleting profile…";
  try {
    await deleteProfile(editingId);
    if (getActiveProfileId(user.uid) === editingId) clearActiveProfileId(user.uid);
    await refreshProfiles();
    dialog.close();
  } catch(error) { editorStatus.textContent = error.message || "Could not delete this profile."; }
  finally { saving = false; deleteButton.disabled = false; }
});
$("manage-toggle").disabled = true;
onAuthStateChanged(auth,async currentUser => {
  if (!currentUser || currentUser.isAnonymous) {
    location.replace("login.html?returnTo=" + encodeURIComponent("profiles.html" + location.search));
    return;
  }
  user = currentUser;
  if (switchingProfile) return;
  $("manage-toggle").disabled = false;
  try {
    let resetProfileId = "";
    try {
      resetProfileId = sessionStorage.getItem("vivid:profile-pin-reset:v1") || "";
      sessionStorage.removeItem("vivid:profile-pin-reset:v1");
    } catch {}
    if (resetProfileId) {
      await resetProfilePin(resetProfileId);
      say("The profile PIN was reset. You can choose the profile and set a new PIN.");
    }
    await refreshProfiles();
  } catch(error) { say(error.message || "Could not load your profiles.",true); grid.replaceChildren(); }
});
