import { VIVID_CONFIG } from "./config.js";

export const VIVID_ROUTES = Object.freeze({
  home: { path: VIVID_CONFIG.routes.home, page: "home" },
  title: { path: VIVID_CONFIG.routes.title, page: "title" },
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
  return `${VIVID_CONFIG.routes.title}?${params.toString()}`;
}
