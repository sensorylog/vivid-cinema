import { VIVID_CONFIG } from "./config.js";

export const VIVID_ROUTES = Object.freeze({
  home: { path: VIVID_CONFIG.routes.home, page: "home" },
  title: { path: VIVID_CONFIG.routes.title, page: "title" },
  watch: { path: VIVID_CONFIG.routes.watch, page: "watch" },
  discover: { path: VIVID_CONFIG.routes.discover, page: "discover" },
  collection: { path: VIVID_CONFIG.routes.collection, page: "collection" },
  library: { path: VIVID_CONFIG.routes.library, page: "library" },
  login: { path: VIVID_CONFIG.routes.login, page: "login" },
  signup: { path: VIVID_CONFIG.routes.signup, page: "signup" },
  account: { path: VIVID_CONFIG.routes.account, page: "account" }
});

export function getRoute(url = window.location.href) {
  const current = new URL(url, window.location.href);
  const pathname = current.pathname.split("/").pop() || "index.html";
  const match = Object.entries(VIVID_ROUTES).find(([, route]) => route.path === pathname);
  return {
    key: match?.[0] || "landing",
    page: match?.[1].page || "landing",
    path: pathname,
    params: current.searchParams,
    url: current
  };
}

export function buildTitleUrl(id, type = "movie") {
  return VIVID_CONFIG.routes.title + "?" + new URLSearchParams({ id: String(id), type });
}

export function buildDiscoverUrl(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString();
  return VIVID_CONFIG.routes.discover + (suffix ? "?" + suffix : "");
}

export function buildCollectionUrl(collection) {
  return VIVID_CONFIG.routes.collection + "?" + new URLSearchParams({ collection: String(collection) });
}

export function buildWatchUrl(id, type = "movie", season = null, episode = null, startAt = null) {
  const params = new URLSearchParams({ id: String(id), type });
  if (type === "tv") {
    if (season !== null && season !== undefined) params.set("season", String(season));
    if (episode !== null && episode !== undefined) params.set("episode", String(episode));
  }
  if (startAt !== null && startAt !== undefined && Number(startAt) > 0) params.set("startAt", String(Math.floor(Number(startAt))));
  return VIVID_CONFIG.routes.watch + "?" + params.toString();
}
