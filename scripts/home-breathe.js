import { tmdbApi } from "./tmdb.js";
import { getImageUrl } from "./media.js";

const rail = document.getElementById("trending-rail");
const art = document.querySelector(".vivid-home-tv-art");
const title = document.querySelector(".vivid-home-tv-title");
const meta = document.querySelector(".vivid-home-tv-meta");

let items = [];
let index = 0;
let timer = null;
let liveAnimations = [];

async function loadDirectTrending() {
  try {
    const data = await tmdbApi.trending("all", "week");
    return (data?.results || []).filter(item => item?.poster_path || item?.backdrop_path).slice(0, 12).map(item => ({
      src: getImageUrl(item.backdrop_path || item.poster_path, "w780"),
      title: item.title || item.name || "Trending now",
      meta: `${(item.release_date || item.first_air_date || "").slice(0, 4) || "Now"} · ${item.media_type === "tv" ? "Series" : "Movie"}`
    }));
  } catch (error) {
    console.warn("Vivid Moment artwork fallback failed:", error);
    return [];
  }
}

function collectTrending() {
  if (!rail) return [];
  return [...rail.querySelectorAll(".vivid-card")].map((card) => {
    const image = card.querySelector(".vivid-card-media img");
    const name = card.querySelector(".vivid-card-title");
    const sub = card.querySelector(".vivid-card-sub");
    return {
      src: image?.currentSrc || image?.src || "",
      title: name?.textContent?.trim() || "Trending now",
      meta: sub?.textContent?.trim() || "Trending on Vivid"
    };
  }).filter((item) => item.src);
}

function showTrendingItem(item) {
  if (!item || !art || !title || !meta) return;
  art.classList.remove("is-changing");
  void art.offsetWidth;
  art.classList.add("is-changing");
  title.classList.remove("is-changing");
  void title.offsetWidth;
  title.classList.add("is-changing");
  art.src = item.src;
  art.alt = "";
  title.textContent = item.title;
  meta.textContent = item.meta;
}

async function refreshTrending() {
  let next = collectTrending();
  if (!next.length) next = await loadDirectTrending();
  if (!next.length) return;

  items = next;
  index %= items.length;
  showTrendingItem(items[index]);
  index = (index + 1) % items.length;

  if (!timer) {
    timer = window.setInterval(async () => {
      let latest = collectTrending();
      if (!latest.length) latest = await loadDirectTrending();
      if (latest.length) items = latest;
      if (!items.length) return;
      showTrendingItem(items[index % items.length]);
      index = (index + 1) % items.length;
    }, 4200);
  }
}


// The Trending rail can still be loading when the cinema moment appears.
// Pull the same TMDB trending feed directly so the TV artwork never depends
// on another rail's lazy-image timing.
window.setTimeout(() => { void refreshTrending(); }, 700);
