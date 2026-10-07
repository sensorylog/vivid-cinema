const rail = document.getElementById("trending-rail");
const art = document.querySelector(".vivid-home-tv-art");
const title = document.querySelector(".vivid-home-tv-title");
const meta = document.querySelector(".vivid-home-tv-meta");

let items = [];
let index = 0;
let timer = null;
let animationObserver = null;
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

function startLiveMotion() {
  const viewer = document.querySelector(".vivid-home-viewer");
  const arm = document.querySelector(".vivid-home-viewer-arm.viewer-arm-right");
  const mouth = document.querySelector(".vivid-home-viewer-mouth");
  const tv = document.querySelector(".vivid-home-tv");
  if (!viewer || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Element.prototype.animate) return;
  liveAnimations.forEach((animation) => animation.cancel());
  liveAnimations = [
    viewer.animate([{transform:"translate3d(0,3px,0) rotate(1deg)"},{transform:"translate3d(0,-2px,0) rotate(-1deg)"},{transform:"translate3d(0,3px,0) rotate(1deg)"}],{duration:4800,iterations:Infinity,easing:"ease-in-out"}),
    arm?.animate([{transform:"rotate(-48deg)"},{transform:"rotate(-58deg)"},{transform:"rotate(-82deg) translate(-3px,7px)"},{transform:"rotate(-50deg)"}],{duration:3600,iterations:Infinity,easing:"cubic-bezier(.2,.8,.2,1)"}),
    mouth?.animate([{transform:"scaleY(1)"},{transform:"scaleY(.45)"},{transform:"scaleY(1.1)"},{transform:"scaleY(1)"}],{duration:900,iterations:Infinity,easing:"ease-in-out"}),
    tv?.animate([{transform:"translate3d(-50%,3px,0) rotate(-.35deg)"},{transform:"translate3d(-50%,-7px,0) rotate(.35deg)"},{transform:"translate3d(-50%,3px,0) rotate(-.35deg)"}],{duration:5600,iterations:Infinity,easing:"ease-in-out"})
  ].filter(Boolean);
}

if (rail) {
  refreshTrending();
  startLiveMotion();
  const observer = new MutationObserver(refreshTrending);
  observer.observe(rail, {childList: true, subtree: true});
  window.setTimeout(() => observer.disconnect(), 15000);
}
