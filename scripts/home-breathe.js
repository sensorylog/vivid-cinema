const rail = document.getElementById("trending-rail");
const art = document.querySelector(".vivid-home-tv-art");
const title = document.querySelector(".vivid-home-tv-title");
const meta = document.querySelector(".vivid-home-tv-meta");

let items = [];
let index = 0;
let timer = null;
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

function refreshTrending() {
  const next = collectTrending();
  if (!next.length) return;
  items = next;
  index %= items.length;
  showTrendingItem(items[index]);
  index = (index + 1) % items.length;
  if (!timer) {
    timer = window.setInterval(() => {
      const latest = collectTrending();
      if (latest.length) items = latest;
      if (!items.length) return;
      showTrendingItem(items[index % items.length]);
      index = (index + 1) % items.length;
    }, 4200);
  }
}

/**
 * Personality layer for the little viewer.
 * CSS already runs the main loops (blink, chew, eat, idle).
 * WAAPI here adds a secondary, slightly irregular "alive" feel
 * that doesn't fight the CSS keyframes.
 */
function startLiveMotion() {
  const tv = document.querySelector(".vivid-home-tv");
  const bucket = document.querySelector(".vivid-home-viewer-popcorn");

  if (
    !window.matchMedia ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !Element.prototype.animate
  ) {
    return;
  }

  liveAnimations.forEach((a) => a.cancel());
  liveAnimations = [];

  // The viewer, head, arm and mouth are intentionally left to CSS.
  // Their CSS transforms now control the TV-facing pose, gaze and eating motion.
  // WAAPI transforms here would override those keyframes and flatten the 3-D turn.

  // Keep only the environmental motion that does not compete with viewer transforms.
  if (bucket) {
    liveAnimations.push(
      bucket.animate(
        [
          { transform: "rotate(-6deg)" },
          { transform: "rotate(-6deg)", offset: 0.3 },
          { transform: "rotate(-16deg) translateY(2px)", offset: 0.4 },
          { transform: "rotate(-3deg)", offset: 0.52 },
          { transform: "rotate(-6deg)" }
        ],
        { duration: 4200, iterations: Infinity, easing: "ease-in-out" }
      )
    );
  }

  if (tv) {
    liveAnimations.push(
      tv.animate(
        [
          { transform: "translate3d(-50%, 2px, 0) rotate(-0.3deg)" },
          { transform: "translate3d(-50%, -4px, 0) rotate(0.3deg)" },
          { transform: "translate3d(-50%, 2px, 0) rotate(-0.3deg)" }
        ],
        { duration: 6400, iterations: Infinity, easing: "ease-in-out" }
      )
    );
  }
}

if (rail) {
  refreshTrending();
  startLiveMotion();
  const observer = new MutationObserver(refreshTrending);
  observer.observe(rail, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
}
