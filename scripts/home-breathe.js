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
  const viewer = document.querySelector(".vivid-home-viewer");
  const head = document.querySelector(".vivid-home-viewer-head");
  const arm = document.querySelector(".vivid-home-viewer-arm.viewer-arm-right");
  const mouth = document.querySelector(".vivid-home-viewer-mouth");
  const tv = document.querySelector(".vivid-home-tv");
  const bucket = document.querySelector(".vivid-home-viewer-popcorn");

  if (
    !viewer ||
    !window.matchMedia ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !Element.prototype.animate
  ) {
    return;
  }

  liveAnimations.forEach((a) => a.cancel());
  liveAnimations = [];

  // Soft body sway — feels like shifting weight while watching
  liveAnimations.push(
    viewer.animate(
      [
        { transform: "scale(0.8) translate3d(0, 2px, 0) rotate(1.1deg)" },
        { transform: "scale(0.8) translate3d(0, -3px, 0) rotate(-0.9deg)" },
        { transform: "scale(0.8) translate3d(1px, 1px, 0) rotate(0.5deg)" },
        { transform: "scale(0.8) translate3d(0, 2px, 0) rotate(1.1deg)" }
      ],
      { duration: 5400, iterations: Infinity, easing: "ease-in-out" }
    )
  );

  // Occasional curious head lean toward the screen
  if (head) {
    liveAnimations.push(
      head.animate(
        [
          { transform: "rotate(-9deg)" },
          { transform: "rotate(-9deg)" },
          { transform: "rotate(-14deg) translate(1px, 1px)" },
          { transform: "rotate(-7deg)" },
          { transform: "rotate(-9deg)" }
        ],
        { duration: 8200, iterations: Infinity, easing: "ease-in-out" }
      )
    );
  }

  // Right arm: clear reach → grab → mouth → rest cycle
  if (arm) {
    liveAnimations.push(
      arm.animate(
        [
          { transform: "rotate(-42deg) translate(0, 0)" },
          { transform: "rotate(-42deg) translate(0, 0)", offset: 0.18 },
          { transform: "rotate(-60deg) translate(-3px, 5px)", offset: 0.28 },
          { transform: "rotate(-82deg) translate(-7px, 12px)", offset: 0.38 },
          { transform: "rotate(-98deg) translate(-5px, 9px)", offset: 0.48 },
          { transform: "rotate(-68deg) translate(-1px, 1px)", offset: 0.58 },
          { transform: "rotate(-48deg) translate(0, 0)", offset: 0.72 },
          { transform: "rotate(-42deg) translate(0, 0)" }
        ],
        { duration: 4200, iterations: Infinity, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" }
      )
    );
  }

  // Mouth chews in sync with the late part of the reach
  if (mouth) {
    liveAnimations.push(
      mouth.animate(
        [
          { transform: "scaleY(1) scaleX(1)" },
          { transform: "scaleY(1) scaleX(1)", offset: 0.5 },
          { transform: "scaleY(0.3) scaleX(1.2)", offset: 0.58 },
          { transform: "scaleY(1.25) scaleX(0.88)", offset: 0.66 },
          { transform: "scaleY(0.5) scaleX(1.08)", offset: 0.74 },
          { transform: "scaleY(1) scaleX(1)", offset: 0.85 },
          { transform: "scaleY(1) scaleX(1)" }
        ],
        { duration: 4200, iterations: Infinity, easing: "ease-in-out" }
      )
    );
  }

  // Bucket reacts when the hand dips in
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

  // TV stays almost still — just a gentle living room float
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
