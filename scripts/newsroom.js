import { escapeHtml } from "./utils.js";

/**
 * Vivid Newsroom — public editorial desk (static feed).
 * Scope: cards, filters, image thumbnails, in-app "Vivid Read" modal only.
 * Does not touch TMDB release radar (news.js), moderated pipeline, or other pages.
 */
const root = document.getElementById("vivid-editorial-feed");
if (root) {
  const filters = [...document.querySelectorAll("[data-editorial-filter]")];
  const status = document.getElementById("vivid-editorial-status");
  let activeFilter = "all";
  let articles = [];
  let visibleCount = 12;
  let lastTrigger = null;
  let lastGeneratedAt = "";

  const labelFor = value => ({
    film: "Film", television: "TV", streaming: "Streaming", celebrity: "People", music: "Music",
    gaming: "Gaming", anime: "Anime", animation: "Animation", "box-office": "Box office",
    festivals: "Festivals", production: "Production", business: "Business", legal: "Legal",
    awards: "Awards", ghana: "Ghana", nollywood: "Nollywood", africa: "Africa",
    asia: "Asia", india: "India", hollywood: "Hollywood", global: "Global",
    europe: "Europe", "latin-america": "Latin America", "middle-east": "Middle East"
  }[value] || "Entertainment");

  // PLACEHOLDER_TRUNCATED - will fix with full file
  console.error("newsroom truncated restore - incomplete");
}
