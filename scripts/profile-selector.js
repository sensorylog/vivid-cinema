import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeProfileFoundation, setActiveProfileId } from "./profiles.js";
import { fetchProfiles, createProfile, updateProfile, deleteProfile, compressProfileImage, PROFILE_AVATARS, MAX_PROFILES } from "./profile-manager.js";

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
    const meta = document.createElement("span");
    meta.className = "profile-card-meta";
    meta.textContent = profile.isOwner ? "Account owner" : profile.isKids ? "Kids profile" : "Vivid profile";
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
    button.setAttribute("aria-checked",String(selectedAvatar === avatar.id));
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
  $("profile-is-kids").checked = profile?.isKids === true;
  $("profile-is-kids").disabled = profile?.isOwner === true;
  $("profile-use-google").hidden = !profile?.isOwner || !googlePhoto;
  editorStatus.textContent = "";
  deleteButton.hidden = !profile || profile.isOwner;
  photoInput.value = "";
  photoPreview.hidden = !selectedAvatarData;
  if (selectedAvatarData || (selectedAvatarSource === "google" && selectedAvatarUrl)) {
    photoPreview.replaceChildren();
    const img = document.createElement("img"); img.src = selectedAvatarData || selectedAvatarUrl; img.alt = "";
    const label = document.createElement("span"); label.textContent = selectedAvatarData ? "Custom photo selected" : "Google photo selected";
    photoPreview.append(img,label);
    photoPreview.hidden = false;
  }
  $("editor-title").textContent = profile ? "Edit profile" : "Create a profile";
  saveButton.textContent = profile ? "Save changes" : "Create profile";
  renderGallery();
  dialog.showModal();
  nameInput.focus();
}
async function chooseProfile(profile) {
  try {
    say("Opening " + profile.name + "…");
    setActiveProfileId(user.uid, profile.id);
    location.replace(destination());
  } catch (error) { say(error.message || "Could not open this profile.",true); }
}
async function refreshProfiles() {
  await initializeProfileFoundation(user);
  profiles = await fetchProfiles();
  googlePhoto = normalizeAvatarUrl(user.photoURL || user.providerData?.find(item => item.providerId === "google.com")?.photoURL || "");
  const owner = profiles.find(profile => profile.isOwner);
  if (owner && ["default","google"].includes(owner.avatarSource) && googlePhoto && owner.avatarUrl !== googlePhoto) {
    await updateProfile(owner.id, {
      name: owner.name,
      avatarId: owner.avatarId,
      avatarUrl: googlePhoto,
      avatarData: "",
      avatarSource: "google"
    });
    profiles = await fetchProfiles();
  }
  if (!profiles.length) throw new Error("No profiles are available for this Vivid account.");
  renderProfiles();
  say("Choose a profile to continue.");
}
$("manage-toggle").addEventListener("click",() => {
  manageMode = !manageMode;
  $("manage-toggle").textContent = manageMode ? "Done" : "Manage profiles";
  $("profile-heading").textContent = manageMode ? "Manage profiles" : "Who's watching?";
  $("profile-subheading").textContent = manageMode ? "Edit names and avatars, or remove a profile." : "Choose your space. Your cinema journey stays yours.";
  renderProfiles();
});
$("profile-use-google").addEventListener("click",() => {
  if (!googlePhoto) return;
  selectedAvatarSource = "google";
  selectedAvatarUrl = googlePhoto;
  selectedAvatarData = "";
  photoPreview.replaceChildren();
  const img = document.createElement("img"); img.src = googlePhoto; img.alt = "";
  const label = document.createElement("span"); label.textContent = "Google photo selected";
  photoPreview.append(img,label);
  photoPreview.hidden = false;
});
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
    const payload = { name, avatarId: selectedAvatar, avatarData: selectedAvatarData, avatarUrl: selectedAvatarUrl, avatarSource: selectedAvatarSource, isKids: $("profile-is-kids").checked };
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
  $("manage-toggle").disabled = false;
  try { await refreshProfiles(); }
  catch(error) { say(error.message || "Could not load your profiles.",true); grid.replaceChildren(); }
});
