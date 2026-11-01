const rail = document.getElementById("trending-rail");
const art = document.querySelector(".vivid-home-tv-art");
const title = document.querySelector(".vivid-home-tv-title");
const meta = document.querySelector(".vivid-home-tv-meta");

let items = [];
let index = 0;
let timer = null;
const legacyPerformance = document.documentElement.classList.contains("vivid-performance-legacy");
let liveAnimations = [];

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
  title.classList.remove("is-changing");
  art.src = item.src;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.requestAnimationFrame(() => {
    art.classList.add("is-changing");
    title.classList.add("is-changing");
  });
  art.alt = "";
  title.textContent = item.title;
  meta.textContent = item.meta;
}

function refreshTrending() {
  const next = collectTrending();
  if (!next.length) return;

  items = next;
  index %= items.length;
  showTrendingItem(items[index]);
  index = (index + 1) % items.length;

  if (!legacyPerformance && !timer && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    timer = window.setInterval(() => {
      if (document.hidden) return;
      const latest = collectTrending();
      if (latest.length) items = latest;
      if (!items.length) return;
      showTrendingItem(items[index % items.length]);
      index = (index + 1) % items.length;
    }, 4200);
  }
}


// Reuse the Home catalogue response rather than requesting a second trending feed.
// The rail is rendered before this event is dispatched.
window.addEventListener("vivid:home-trending-ready", () => refreshTrending());
