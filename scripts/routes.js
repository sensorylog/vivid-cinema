import { VIVID_CONFIG } from "./config.js";

export const VIVID_ROUTES = Object.freeze({
  home: { path: VIVID_CONFIG.routes.home, page: "home" },
  title: { path: VIVID_CONFIG.routes.title, page: "title" },
  watch: { path: VIVID_CONFIG.routes.watch, page: "watch" },
  discover: { path: VIVID_CONFIG.routes.discover, page: "discover" },
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
  const params = new URLSearchParams({ id: String(id), type });
  return VIVID_CONFIG.routes.title + "?" + params.toString();
}

export function buildDiscoverUrl(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString();
  return VIVID_CONFIG.routes.discover + (suffix ? "?" + suffix : "");
}

export function buildWatchUrl(id, type = "movie", season = null, episode = null) {
  const params = new URLSearchParams({ id: String(id), type });
  if (type === "tv") {
    if (season !== null && season !== undefined) params.set("season", String(season));
    if (episode !== null && episode !== undefined) params.set("episode", String(episode));
  }
  return VIVID_CONFIG.routes.watch + "?" + params.toString();
}
