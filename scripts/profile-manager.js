import { auth } from "./firebase.js";
import { MAX_PROFILES, PROFILE_AVATARS, normalizeProfile } from "./profile-schema.js";

async function profileRequest(path, method = "GET", payload = null) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Sign in with your Vivid account to manage profiles.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(payload ? { "Content-Type": "application/json" } : {})
    },
    body: payload ? JSON.stringify(payload) : undefined,
    credentials: "same-origin",
    cache: "no-store"
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.ok === false) {
    const error = new Error(result.message || "Vivid couldn't update profiles right now.");
    error.code = result.code || "profile-request-failed";
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function fetchProfiles() {
  const result = await profileRequest("/api/profiles");
  return Array.isArray(result.profiles) ? result.profiles.map(profile => normalizeProfile(profile.id, profile)) : [];
}

export async function createProfile(details) {
  const result = await profileRequest("/api/profiles", "POST", details);
  return normalizeProfile(result.profile.id, result.profile);
}

export async function updateProfile(profileId, details) {
  const result = await profileRequest("/api/profiles/update", "PATCH", { profileId, ...details });
  return normalizeProfile(result.profile.id, result.profile);
}

export async function deleteProfile(profileId) {
  return profileRequest("/api/profiles/delete", "DELETE", { profileId });
}

export async function compressProfileImage(file) {
  if (!(file instanceof Blob) || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(String(file.type || "").toLowerCase())) {
    throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  }
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the profile photo.");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.type !== "image/webp") throw new Error("This browser cannot create a WebP profile photo.");
    if (blob.size > 130 * 1024) throw new Error("That image is still too large. Choose a smaller photo.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("The selected photo could not be read."));
      reader.readAsDataURL(blob);
    });
    return data;
  } finally {
    image.close?.();
  }
}

export { MAX_PROFILES, PROFILE_AVATARS };
