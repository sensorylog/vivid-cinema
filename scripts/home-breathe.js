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

/* ═══════════════════════════════════════════════════════════
   Vivid Moment – clean layout + character that watches the TV
   ═══════════════════════════════════════════════════════════ */

.vivid-home-breathe {
  position: relative !important;
  isolation: isolate !important;
  overflow: hidden !important;
  clear: both !important;
  z-index: 1 !important;
  display: grid !important;
  place-items: center !important;
  min-height: 520px !important;
  margin: clamp(28px, 5vw, 64px) 0 clamp(20px, 4vw, 48px) !important;
  padding: 0 12px !important;
}

.vivid-home-breathe-scene {
  position: relative !important;
  width: min(720px, 94vw) !important;
  min-height: 480px !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: flex-start !important;
}

/* ── TV – fully visible, centered ─────────────────────────── */
.vivid-home-tv {
  position: relative !important;
  z-index: 3 !important;
  top: 0 !important;
  left: auto !important;
  right: auto !important;
  width: min(380px, 78vw) !important;
  margin: 0 auto 8px !important;
  transform: none !important;
  filter: drop-shadow(0 24px 40px rgba(0,0,0,.42)) !important;
  animation: 6s ease-in-out infinite vivid-tv-float !important;
}

.vivid-home-tv::before {
  content: "" !important;
  position: absolute !important;
  z-index: -1 !important;
  left: 12% !important;
  right: 12% !important;
  bottom: 4px !important;
  height: 28px !important;
  border-radius: 50% !important;
  background: radial-gradient(rgba(140,165,255,.2), transparent 70%) !important;
  filter: blur(16px) !important;
}

.vivid-home-tv-screen {
  position: relative !important;
  inset: 0 0 16px !important;
  border: 7px solid #16191f !important;
  border-radius: 18px !important;
  background: #07090c !important;
  overflow: hidden !important;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.1),
    inset 0 1px 0 rgba(255,255,255,.08),
    0 16px 40px rgba(0,0,0,.35) !important;
}

.vivid-home-tv-art {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  opacity: .92 !important;
}

.vivid-home-tv-stand {
  position: absolute !important;
  left: 50% !important;
  bottom: 0 !important;
  width: 100px !important;
  height: 20px !important;
  transform: translateX(-50%) !important;
  background: linear-gradient(#2a2e38, #0e1014) !important;
  clip-path: polygon(32% 0, 68% 0, 82% 100%, 18% 100%) !important;
  border-radius: 0 0 10px 10px !important;
}

/* ── Character – sits under the TV, faces it ──────────────── */
.vivid-home-viewer {
  position: relative !important;
  z-index: 6 !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  width: 160px !important;
  height: 190px !important;
  margin: -28px auto 12px !important;          /* sits just under the TV stand */
  transform: scale(0.72) rotateY(-26deg) rotateX(3deg) !important;
  transform-origin: 50% 100% !important;
  transform-style: preserve-3d !important;
  filter: drop-shadow(-10px 14px 18px rgba(0,0,0,.4)) !important;
  animation: 5s ease-in-out infinite vivid-viewer-watch !important;
}

/* Head turned toward TV */
.vivid-home-viewer-head {
  position: absolute !important;
  top: 0 !important;
  left: 46px !important;
  width: 64px !important;
  height: 64px !important;
  border-radius: 50% !important;
  background: linear-gradient(145deg, #e0b08a, #c07a55 55%, #a85f42) !important;
  border: 2px solid rgba(80,35,25,.28) !important;
  box-shadow:
    inset -8px -8px 0 rgba(120,50,35,.14),
    inset 4px 5px 8px rgba(255,230,200,.15),
    -4px 6px 14px rgba(0,0,0,.25) !important;
  transform: rotate(-12deg) rotateY(-16deg) !important;
  transform-origin: 50% 75% !important;
  z-index: 5 !important;
  animation: 6.5s ease-in-out infinite vivid-viewer-head !important;
}

.vivid-home-viewer-head::before {
  content: "" !important;
  position: absolute !important;
  left: 6px !important;
  top: -4px !important;
  width: 52px !important;
  height: 20px !important;
  border-radius: 55% 55% 30% 30% !important;
  background: #16181d !important;
  transform: rotate(-5deg) !important;
}

/* Eyes looking left at the TV */
.vivid-home-viewer-eye {
  position: absolute !important;
  top: 28px !important;
  width: 7px !important;
  height: 6px !important;
  border-radius: 50% !important;
  background: #1a1c22 !important;
  animation: 5.2s ease-in-out infinite vivid-viewer-blink !important;
}
.vivid-home-viewer-eye.eye-left  { left: 14px !important; }
.vivid-home-viewer-eye.eye-right { right: 20px !important; }

.vivid-home-viewer-mouth {
  position: absolute !important;
  left: 26px !important;
  top: 44px !important;
  width: 12px !important;
  height: 7px !important;
  border-bottom: 2.5px solid #6c332c !important;
  border-radius: 0 0 12px 12px !important;
  animation: 1s ease-in-out infinite vivid-viewer-chew !important;
}

.vivid-home-viewer-body {
  position: absolute !important;
  left: 36px !important;
  top: 54px !important;
  width: 88px !important;
  height: 88px !important;
  border-radius: 40px 40px 22px 22px !important;
  background: linear-gradient(145deg, #242933, #101217) !important;
  border: 1px solid rgba(255,255,255,.08) !important;
  box-shadow: 0 12px 24px rgba(0,0,0,.3) !important;
  transform: rotateY(-10deg) rotateZ(-2deg) !important;
}

.vivid-home-viewer-arm {
  position: absolute !important;
  z-index: 4 !important;
  width: 16px !important;
  height: 76px !important;
  border-radius: 999px !important;
  background: #c88765 !important;
  transform-origin: 50% 10px !important;
}
.vivid-home-viewer-arm.viewer-arm-left {
  left: 28px !important;
  top: 72px !important;
  transform: rotate(28deg) !important;
}
.vivid-home-viewer-arm.viewer-arm-right {
  left: 110px !important;
  top: 70px !important;
  transform: rotate(-40deg) !important;
  animation: 3.6s ease-in-out infinite vivid-viewer-eat !important;
}

.vivid-home-viewer-hand {
  position: absolute !important;
  left: -2px !important;
  bottom: -4px !important;
  width: 20px !important;
  height: 20px !important;
  border-radius: 50% !important;
  background: #d9a47b !important;
}

.vivid-home-viewer-popcorn {
  position: absolute !important;
  z-index: 3 !important;
  right: 4px !important;
  top: 118px !important;
  width: 42px !important;
  height: 40px !important;
  border-radius: 4px 4px 8px 8px !important;
  background: repeating-linear-gradient(90deg, #f3f3f2 0 7px, #272a31 7px 14px) !important;
  border: 1px solid rgba(255,255,255,.12) !important;
}

.vivid-home-viewer-leg {
  position: absolute !important;
  top: 136px !important;
  width: 34px !important;
  height: 64px !important;
  border-radius: 16px 16px 10px 10px !important;
  background: linear-gradient(#1c2028, #101318) !important;
  transform-origin: center top !important;
  box-shadow: 0 6px 12px rgba(0,0,0,.22) !important;
}
.vivid-home-viewer-leg.leg-left  { left: 42px !important; transform: rotate(20deg) !important; }
.vivid-home-viewer-leg.leg-right { left: 90px !important; transform: rotate(-16deg) !important; }

/* ── Copy – clean, fully visible under everything ─────────── */
.vivid-home-breathe-copy {
  position: relative !important;
  z-index: 8 !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  width: min(520px, 92vw) !important;
  margin: 8px auto 0 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  transform: none !important;
}

.vivid-home-breathe-kicker {
  font-size: .6rem !important;
  letter-spacing: .2em !important;
  font-weight: 700 !important;
  color: #777e89 !important;
}

.vivid-home-breathe-copy strong {
  margin-top: 6px !important;
  font-size: clamp(1.25rem, 3.2vw, 1.75rem) !important;
  letter-spacing: -.04em !important;
  font-weight: 700 !important;
  color: #f4f5f7 !important;
}

.vivid-home-breathe-copy small {
  margin-top: 6px !important;
  color: #747b86 !important;
  font-size: .76rem !important;
  line-height: 1.45 !important;
  max-width: 340px !important;
}

.vivid-home-breathe-action {
  margin-top: 14px !important;
  padding: 9px 16px !important;
  border: 1px solid rgba(255,255,255,.12) !important;
  border-radius: 999px !important;
  color: rgba(255,255,255,.8) !important;
  background: rgba(255,255,255,.045) !important;
  font-size: .72rem !important;
  font-weight: 650 !important;
  text-decoration: none !important;
  transition: transform .2s, background .2s !important;
}
.vivid-home-breathe-action:hover {
  transform: translateY(-2px) !important;
  background: rgba(255,255,255,.08) !important;
}

/* ── Keyframes ────────────────────────────────────────────── */
@keyframes vivid-tv-float {
  0%, 100% { transform: translateY(2px) rotate(-.3deg); }
  50%      { transform: translateY(-5px) rotate(.3deg); }
}

@keyframes vivid-viewer-watch {
  0%, 100% { transform: scale(0.72) rotateY(-26deg) rotateX(3deg) translateY(2px) rotateZ(.6deg); }
  40%      { transform: scale(0.72) rotateY(-28deg) rotateX(4deg) translateY(-3px) rotateZ(-.5deg); }
  70%      { transform: scale(0.72) rotateY(-24deg) rotateX(2deg) translateY(1px) rotateZ(.3deg); }
}

@keyframes vivid-viewer-head {
  0%, 100% { transform: rotate(-12deg) rotateY(-16deg) translateY(0); }
  40%      { transform: rotate(-15deg) rotateY(-20deg) translateY(1px); }
  65%      { transform: rotate(-9deg)  rotateY(-13deg) translateY(-1px); }
}

@keyframes vivid-viewer-blink {
  0%, 42%, 50%, 100% { transform: scaleY(1); }
  46%                { transform: scaleY(0.1); }
}

@keyframes vivid-viewer-chew {
  0%, 100% { transform: scaleY(1) scaleX(1); }
  30%      { transform: scaleY(0.35) scaleX(1.15); }
  55%      { transform: scaleY(1.15) scaleX(0.9); }
  75%      { transform: scaleY(0.5) scaleX(1.05); }
}

@keyframes vivid-viewer-eat {
  0%, 22%, 100% { transform: rotate(-40deg) translate(0,0); }
  32%           { transform: rotate(-58deg) translate(-4px,6px); }
  44%           { transform: rotate(-82deg) translate(-8px,13px); }
  56%           { transform: rotate(-92deg) translate(-6px,10px); }
  68%           { transform: rotate(-62deg) translate(-2px,2px); }
  80%           { transform: rotate(-40deg) translate(0,0); }
}

/* ── Mobile tightening ────────────────────────────────────── */
@media (max-width: 520px) {
  .vivid-home-breathe {
    min-height: 480px !important;
    margin: 20px 0 28px !important;
  }
  .vivid-home-breathe-scene {
    min-height: 440px !important;
  }
  .vivid-home-tv {
    width: min(320px, 82vw) !important;
  }
  .vivid-home-viewer {
    width: 150px !important;
    height: 180px !important;
    margin: -22px auto 8px !important;
    transform: scale(0.62) rotateY(-24deg) rotateX(2deg) !important;
    animation-name: vivid-viewer-watch-xs !important;
  }
  @keyframes vivid-viewer-watch-xs {
    0%, 100% { transform: scale(0.62) rotateY(-24deg) rotateX(2deg) translateY(2px) rotateZ(.5deg); }
    40%      { transform: scale(0.62) rotateY(-26deg) rotateX(3deg) translateY(-2px) rotateZ(-.4deg); }
    70%      { transform: scale(0.62) rotateY(-22deg) rotateX(1deg) translateY(1px) rotateZ(.3deg); }
  }
  .vivid-home-breathe-copy {
    width: calc(100% - 24px) !important;
  }
  .vivid-home-breathe-copy small {
    max-width: 300px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vivid-home-tv,
  .vivid-home-viewer,
  .vivid-home-viewer-head,
  .vivid-home-viewer-eye,
  .vivid-home-viewer-mouth,
  .vivid-home-viewer-arm.viewer-arm-right {
    animation: none !important;
  }
}