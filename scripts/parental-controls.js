import { tmdbApi } from "./tmdb.js";
import { getProviderCountry } from "./provider-region.js";

const MOVIE_AGE = Object.freeze({ G: 0, PG: 7, "PG-13": 13, R: 17, "NC-17": 18 });
const TV_AGE = Object.freeze({ "TV-Y": 0, "TV-Y7": 7, "TV-G": 0, "TV-PG": 10, "TV-14": 14, "TV-MA": 17 });
const certificationCache = new Map();
const titleMetadataCache = new Map();
let currentProfile = null;
let currentUid = "";
let loadedAt = 0;

function normalizeCertification(value, type) {
  const rating = String(value || "").trim().toUpperCase();
  if (type === "movie") {
    if (["U", "0", "G", "ALL"].includes(rating)) return "G";
    if (["6", "7", "PG"].includes(rating)) return "PG";
    if (["12A", "12", "13", "PG-13"].includes(rating)) return "PG-13";
    if (["15", "16", "R"].includes(rating)) return "R";
    if (["18", "NC-17", "X"].includes(rating)) return "NC-17";
    return "";
  }
  if (rating === "TV-Y") return "TV-Y";
  if (["U", "0", "TV-G"].includes(rating)) return "TV-G";
  if (["TV-Y7", "7"].includes(rating)) return "TV-Y7";
  if (["PG", "12", "TV-PG"].includes(rating)) return "TV-PG";
  if (["13", "14", "TV-14"].includes(rating)) return "TV-14";
  if (["15", "16", "18", "TV-MA"].includes(rating)) return "TV-MA";
  return "";
}

function mostRestrictiveCertification(values, type) {
  const scale = type === "tv" ? TV_AGE : MOVIE_AGE;
  const normalized = values.map(value => normalizeCertification(value, type));
  // An unknown listed rating is not treated as safe just because another
  // release entry has a known rating.
  if (normalized.some(value => !value)) return "";
  return normalized.sort((a, b) => scale[b] - scale[a])[0] || "";
}

async function getActiveProfile() {
  if (typeof window === "undefined") return null;
  const [{ auth }, { listProfileSummaries, getActiveProfileId }] = await Promise.all([
    import("./firebase.js"),
    import("./profiles.js")
  ]);
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    currentProfile = null;
    currentUid = "";
    loadedAt = 0;
    return null;
  }

  const token = await user.getIdTokenResult();
  const profileId = String(token.claims.profileId || getActiveProfileId(user.uid));
  if (
    currentProfile &&
    currentUid === user.uid &&
    currentProfile.id === profileId &&
    Date.now() - loadedAt < 60000
  ) return currentProfile;

  const cacheKey = "vivid:parental-policy:v1:" + user.uid + ":" + profileId;
  try {
    const result = await listProfileSummaries(user);
    currentProfile = result.profiles.find(profile => profile.id === profileId) || null;
    if (!currentProfile) throw new Error("The active profile could not be validated.");
    try { localStorage.setItem(cacheKey, JSON.stringify(currentProfile)); } catch {}
  } catch (error) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch {}

    // A Kids token always fails closed, even when policy services are offline.
    if (token.claims.isKids === true) {
      currentProfile = cached?.isKids === true ? cached : {
        id: profileId,
        isKids: true,
        movieRatingLimit: "PG",
        tvRatingLimit: "TV-PG",
        blockedGenreIds: [27, 53, 80, 10752],
        blockedTitles: [],
        allowUnrated: false
      };
    } else if (token.claims.isKids === false) {
      currentProfile = { id: profileId, isKids: false };
    } else if (cached?.id === profileId) {
      currentProfile = cached;
    } else if (profileId === "owner") {
      currentProfile = { id: profileId, isKids: false };
    } else {
      throw error;
    }
  }

  currentUid = user.uid;
  loadedAt = Date.now();
  return currentProfile;
}

async function getTitleMetadata(type, id) {
  const key = type + ":" + id;
  if (titleMetadataCache.has(key)) return titleMetadataCache.get(key);
  const pending = (type === "tv" ? tmdbApi.tvDetails(id) : tmdbApi.movieDetails(id))
    .then(details => {
      if (!details?.id) throw new Error("Title metadata is unavailable.");
      return details;
    })
    .catch(error => {
      titleMetadataCache.delete(key);
      throw error;
    });
  titleMetadataCache.set(key, pending);
  return pending;
}

async function getCertification(type, id) {
  const country = getProviderCountry() || "US";
  const key = type + ":" + id + ":" + country;
  if (certificationCache.has(key)) return certificationCache.get(key);

  const data = type === "tv"
    ? await tmdbApi.tvContentRatings(id)
    : await tmdbApi.movieReleaseDates(id);
  let value = "";

  if (type === "tv") {
    const rows = data?.results || [];
    const localRatings = rows.filter(row => row.iso_3166_1 === country && row.rating).map(row => row.rating);
    const usRatings = rows.filter(row => row.iso_3166_1 === "US" && row.rating).map(row => row.rating);
    value = mostRestrictiveCertification(localRatings, type) ||
      (localRatings.length ? "" : mostRestrictiveCertification(usRatings, type));
  } else {
    const localGroup = data?.results?.find(group => group.iso_3166_1 === country);
    const usGroup = data?.results?.find(group => group.iso_3166_1 === "US");
    const localRatings = (localGroup?.release_dates || []).map(item => item.certification).filter(Boolean);
    const usRatings = (usGroup?.release_dates || []).map(item => item.certification).filter(Boolean);
    value = mostRestrictiveCertification(localRatings, type) ||
      (localRatings.length ? "" : mostRestrictiveCertification(usRatings, type));
  }

  certificationCache.set(key, value);
  return value;
}

export async function isTitleAllowed(item = {}, options = {}) {
  const profile = await getActiveProfile();
  if (!profile?.isKids) return true;

  const type = item.media_type || item.mediaType || options.type;
  if (type !== "movie" && type !== "tv") return false;
  const id = String(item.id || options.id || "");
  if (!/^[1-9][0-9]{0,11}$/.test(id) || item.adult === true) return false;
  if ((profile.blockedTitles || []).includes(type + ":" + id)) return false;

  let metadata = item;
  const hasGenreMetadata =
    (Array.isArray(item.genre_ids) && item.genre_ids.length > 0) ||
    (Array.isArray(item.genres) && item.genres.length > 0);
  if (!hasGenreMetadata || typeof item.adult !== "boolean") {
    try {
      // Saved library and offline records from older versions may not contain
      // genre metadata. Resolve it before applying genre restrictions.
      metadata = { ...item, ...(await getTitleMetadata(type, id)) };
    } catch {
      return false;
    }
  }

  if (metadata.adult === true) return false;
  const genres = [
    ...(metadata.genre_ids || []),
    ...(metadata.genres || []).map(genre => genre?.id)
  ].map(Number);
  if (genres.some(genre => (profile.blockedGenreIds || []).includes(genre))) return false;

  let certification = String(options.certification || metadata.certification || "");
  if (!certification) {
    try { certification = await getCertification(type, id); }
    catch { return false; }
  }
  const normalized = normalizeCertification(certification, type);
  if (!normalized) return profile.allowUnrated === true;

  const scale = type === "tv" ? TV_AGE : MOVIE_AGE;
  const ceiling = scale[type === "tv" ? profile.tvRatingLimit : profile.movieRatingLimit];
  return Number.isFinite(ceiling) && scale[normalized] <= ceiling;
}

export async function filterAllowedTitles(items = []) {
  const list = Array.isArray(items) ? items : [];
  const profile = await getActiveProfile();
  if (!profile?.isKids) return list;

  const output = new Array(list.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(5, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      const item = list[index];
      if (item?.media_type === "person") {
        output[index] = item;
        continue;
      }
      try {
        if (await isTitleAllowed(item)) output[index] = item;
      } catch {
        // Fail closed for Kids profiles when policy or title metadata is unavailable.
      }
    }
  }));
  return output.filter(Boolean);
}

export function renderParentalBlock(node, title = "This title") {
  if (!node) return;
  const safeTitle = String(title).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  node.innerHTML =
    '<section class="vivid-parental-block" role="alert">' +
      '<i class="bi bi-shield-lock-fill" aria-hidden="true"></i>' +
      '<h1>Parent-approved viewing only</h1>' +
      '<p>' + safeTitle + ' isn’t available in this Kids profile. Choose another title or ask a parent to review the viewing settings.</p>' +
      '<a class="vivid-button vivid-button--secondary" href="home.html">Back to Kids home</a>' +
    '</section>';
}
