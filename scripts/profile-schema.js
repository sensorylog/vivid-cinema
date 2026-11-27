export const PROFILE_SCHEMA_VERSION = 1;
export const OWNER_PROFILE_ID = "owner";
export const MAX_PROFILES = 5;
export const MAX_AVATAR_DATA_LENGTH = 180000;
export const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PROFILE_DATA_COLLECTIONS = Object.freeze(["favorites","watchLater","history","completed","progress","libraryTombstones","feedback","events","taste","animePreferences","achievements"]);

export const PROFILE_AVATARS = Object.freeze([
  Object.freeze({ id: "aurora", label: "Aurora" }),
  Object.freeze({ id: "ember", label: "Ember" }),
  Object.freeze({ id: "nebula", label: "Nebula" }),
  Object.freeze({ id: "eclipse", label: "Eclipse" }),
  Object.freeze({ id: "nova", label: "Nova" }),
  Object.freeze({ id: "prism", label: "Prism" }),
  Object.freeze({ id: "orbit", label: "Orbit" }),
  Object.freeze({ id: "titan", label: "Titan" }),
  Object.freeze({ id: "ripple", label: "Ripple" }),
  Object.freeze({ id: "halo", label: "Halo" }),
  Object.freeze({ id: "flux", label: "Flux" }),
  Object.freeze({ id: "onyx", label: "Onyx" }),
  Object.freeze({ id: "solstice", label: "Solstice" }),
  Object.freeze({ id: "comet", label: "Comet" }),
  Object.freeze({ id: "vortex", label: "Vortex" }),
  Object.freeze({ id: "lumen", label: "Lumen" })
]);
export const PROFILE_AVATAR_IDS = new Set(PROFILE_AVATARS.map(avatar => avatar.id));

export function normalizeProfileId(value) {
  const id = String(value || "").trim();
  if (!PROFILE_ID_PATTERN.test(id)) throw new TypeError("A valid profile ID is required.");
  return id;
}

export function normalizeProfileName(value, fallback = "Vivid Profile") {
  const name = typeof value === "string"
    ? Array.from(value).filter(character => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    }).join("").trim().slice(0, 48)
    : "";
  return name || fallback;
}

export function normalizeAvatarUrl(value) {
  if (typeof value !== "string" || !value.trim().toLowerCase().startsWith("https://")) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href.slice(0, 2048);
  } catch {
    return "";
  }
}

export function normalizeAvatarData(value) {
  const prefix = "data:image/webp;base64,";
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > MAX_AVATAR_DATA_LENGTH) return "";
  const payload = value.slice(prefix.length);
  return payload.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(payload) ? value : "";
}

export function normalizeProfile(profileId, data = {}) {
  const id = normalizeProfileId(profileId);
  const isKids = id !== OWNER_PROFILE_ID && data.isKids === true;
  return {
    id,
    name: normalizeProfileName(data.name, id === OWNER_PROFILE_ID ? "Main Profile" : "Vivid Profile"),
    avatarId: PROFILE_AVATAR_IDS.has(String(data.avatarId || "")) ? String(data.avatarId) : "aurora",
    avatarUrl: normalizeAvatarUrl(data.avatarUrl),
    avatarData: normalizeAvatarData(data.avatarData),
    isKids,
    maturityLevel: isKids ? "kids" : "adult",
    isOwner: id === OWNER_PROFILE_ID,
    schemaVersion: PROFILE_SCHEMA_VERSION
  };
}
