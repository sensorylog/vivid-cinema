import { getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-analytics.js";
import { app } from "./firebase.js";

let analytics = null;

async function initAnalytics() {
  try {
    if (!(await isSupported())) return null;
    analytics = getAnalytics(app);
    setAnalyticsCollectionEnabled(analytics, true);
    return analytics;
  } catch (error) {
    console.warn("Vivid Analytics unavailable:", error);
    return null;
  }
}

const ready = initAnalytics();

async function track(name, params = {}) {
  const instance = analytics || await ready;
  if (!instance) return;
  try {
    logEvent(instance, name, {
      ...params,
      page_path: location.pathname
    });
  } catch (error) {
    console.debug("Analytics event skipped:", name, error);
  }
}

window.vividAnalytics = Object.freeze({ track, ready });

document.addEventListener("click", event => {
  const card = event.target.closest?.("[data-id][data-type]");
  if (card) {
    track("content_click", {
      content_id: String(card.dataset.id),
      content_type: card.dataset.type,
      content_title: card.querySelector(".vivid-card-title,.movie-title")?.textContent?.trim() || undefined
    });
    return;
  }

  const discoveryCard = event.target.closest?.(".vivid-discovery-card,.vivid-search-result");
  if (discoveryCard) {
    track("content_click", { content_title: discoveryCard.querySelector("strong,.vivid-card-title")?.textContent?.trim() || undefined, destination: discoveryCard.getAttribute("href") || undefined });
    return;
  }

  const loadMore = event.target.closest?.("[data-load-section],#load-more,#collection-more");
  if (loadMore) track("load_more", { section: loadMore.dataset.loadSection || "similar" });

  const watch = event.target.closest?.("#hero-watch,[data-watch],#stream-button,.stream-button");
  if (watch) track("stream_click", { source: location.pathname });
});

document.addEventListener("submit", event => {
  const form = event.target;
  if (form.matches?.("[data-landing-email-form]")) track("signup_start", { method: "email" });
  else if (form.matches?.("#signup-form")) track("signup_submit", { method: "email" });
  else if (form.matches?.("#login-form")) track("login_submit", { method: "email" });
});

document.addEventListener("input", event => {
  const input = event.target;
  if (!input.matches?.("#search-input")) return;
  const query = input.value.trim();
  if (query.length >= 3) {
    clearTimeout(input.__vividAnalyticsTimer);
    input.__vividAnalyticsTimer = setTimeout(() => track("search", { search_term: query.slice(0, 100) }), 700);
  }
});
