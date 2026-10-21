import { VIVID_CONFIG } from "../config.js";

const cleanBase = (value, fallback) => String(value || fallback).replace(/\/+$/, "");
const isResumePoint = value => Number.isFinite(Number(value)) && Number(value) > 5;
const addResume = (query, key, startAt) => {
  if (isResumePoint(startAt)) query.set(key, String(Math.floor(Number(startAt))));
};

function standardId(params, tmdbId, imdbId) {
  const routeId = String(params?.id || "").trim();
  if (/^tt\d+$/i.test(routeId)) return routeId;
  return String(tmdbId || imdbId || routeId).trim();
}

function tmdbOnlyId(params, tmdbId) {
  const id = String(tmdbId || (/^\d+$/.test(String(params?.id || "")) ? params.id : "")).trim();
  return /^\d+$/.test(id) ? id : "";
}

export function buildVidapiEmbedUrl(params, { startAt = 0 } = {}) {
  const id = standardId(params, "", "");
  if (!id) return "";
  const base = cleanBase(VIVID_CONFIG.api.vidapiEmbedBaseUrl, "https://vaplayer.ru");
  const query = new URLSearchParams({ autoplay: "1", controls: "1", overlay: "1" });
  addResume(query, "resumeAt", startAt);
  const path = params.type === "tv"
    ? "/embed/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/embed/movie/" + encodeURIComponent(id);
  return base + path + "?" + query;
}

export function buildVidsrcEmbedUrl(params, { tmdbId = "", imdbId = "", startAt = 0 } = {}) {
  const routeId = String(params?.id || "").trim();
  const id = String(tmdbId || imdbId || (/^tt\d+$/i.test(routeId) ? routeId : /^\d+$/.test(routeId) ? routeId : "")).trim();
  if (!id) return "";
  const base = cleanBase(VIVID_CONFIG.api.vidsrcEmbedBaseUrl, "https://vidsrc.sh");
  const path = params.type === "tv"
    ? "/embed/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/embed/movie/" + encodeURIComponent(id);
  const query = new URLSearchParams({ ds_lang: "en" });
  addResume(query, "startAt", startAt);
  return base + path + "?" + query;
}

export function buildVidlinkEmbedUrl(params, { tmdbId = "", malId = "", anime = false, startAt = 0 } = {}) {
  const base = cleanBase(VIVID_CONFIG.api.vidlinkEmbedBaseUrl, "https://vidlink.pro");
  // Vivid's server-picker tap is the user's play intent; ask the provider to begin playback.
  const query = new URLSearchParams({ primaryColor: "e50914", secondaryColor: "1b1b1b", iconColor: "ffffff", title: "false", poster: "false", autoplay: "true" });
  addResume(query, "startAt", startAt);
  if (anime) {
    if (!/^\d+$/.test(String(malId || ""))) return "";
    query.set("fallback", "true");
    return base + "/anime/" + encodeURIComponent(String(malId)) + "/" + Math.max(1, Number(params.episode) || 1) + "/sub?" + query;
  }
  const id = tmdbOnlyId(params, tmdbId);
  if (!id) return "";
  const path = params.type === "tv"
    ? "/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/movie/" + encodeURIComponent(id);
  return base + path + "?" + query;
}

export function buildVidplusEmbedUrl(params, { tmdbId = "", aniListId = "", anime = false, startAt = 0 } = {}) {
  const base = cleanBase(VIVID_CONFIG.api.vidplusEmbedBaseUrl, "https://player.vidplus.to");
  const query = new URLSearchParams({ autoplay: "true", primarycolor: "e50914", secondarycolor: "171717", iconcolor: "ffffff" });
  if (anime) {
    if (!/^\d+$/.test(String(aniListId || ""))) return "";
    query.set("dub", "false");
    return base + "/embed/anime/" + encodeURIComponent(String(aniListId)) + "/" + Math.max(1, Number(params.episode) || 1) + "?" + query;
  }
  const id = tmdbOnlyId(params, tmdbId);
  if (!id) return "";
  addResume(query, "progress", startAt);
  const path = params.type === "tv"
    ? "/embed/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/embed/movie/" + encodeURIComponent(id);
  return base + path + "?" + query;
}

export function buildVidkingEmbedUrl(params, { tmdbId = "", startAt = 0 } = {}) {
  const id = tmdbOnlyId(params, tmdbId);
  if (!id) return "";
  const query = new URLSearchParams({ color: "e50914", autoPlay: "true" });
  // VidKing documents progress as a timestamp in seconds.
  addResume(query, "progress", startAt);
  const path = params.type === "tv"
    ? "/embed/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/embed/movie/" + encodeURIComponent(id);
  return "https://www.vidking.net" + path + "?" + query;
}


function movieTvId(params, tmdbId = "", imdbId = "") {
  return standardId(params, tmdbId, imdbId);
}
function movieTvPath(params, id, prefix = "/embed") {
  if (!id) return "";
  return params.type === "tv"
    ? prefix + "/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : prefix + "/movie/" + encodeURIComponent(id);
}
export function buildEmbedWaveUrl(params, { tmdbId = "" } = {}) {
  const id = tmdbOnlyId(params, tmdbId);
  return id ? "https://embedwave.cc" + movieTvPath(params, id) + "?autoplay=true" : "";
}
export function buildVidFastUrl(params, { tmdbId = "", imdbId = "" } = {}) {
  const id = movieTvId(params, tmdbId, imdbId);
  return id ? "https://vidfast.to" + movieTvPath(params, id) : "";
}
export function buildEzVidApiUrl(params, { tmdbId = "" } = {}) {
  const id = tmdbOnlyId(params, tmdbId);
  return id ? "https://ezvidapi.com" + movieTvPath(params, id) : "";
}
export function buildEmbedApiStreamUrl(params, { tmdbId = "", imdbId = "" } = {}) {
  const id = movieTvId(params, tmdbId, imdbId);
  return id ? "https://watch.embed-api.stream" + movieTvPath(params, id) : "";
}
export function buildMoviesApiUrl(params, { tmdbId = "", imdbId = "", startAt = 0 } = {}) {
  const id = movieTvId(params, tmdbId, imdbId);
  if (!id) return "";
  const path = params.type === "tv"
    ? "/tv/" + encodeURIComponent(id) + "/" + Math.max(1, Number(params.season) || 1) + "/" + Math.max(1, Number(params.episode) || 1)
    : "/movie/" + encodeURIComponent(id);
  const query = new URLSearchParams({ theme: "e50914" });
  addResume(query, "t", startAt);
  return "https://moviesapi.to" + path + "?" + query;
}
