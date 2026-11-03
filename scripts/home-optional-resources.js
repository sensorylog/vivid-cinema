const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap";
const ICON_STYLESHEET = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.9.1/font/bootstrap-icons.css";

function loadStylesheet(href, marker) {
  if (document.querySelector("[data-" + marker + "]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset[marker] = "true";
  document.head.appendChild(link);
}

function loadEnhancements() {
  // Fonts and icon glyphs are visual polish, not prerequisites for first paint.
  // Keep system-font and text-label fallbacks usable while these arrive.
  loadStylesheet(FONT_STYLESHEET, "vividHomeFonts");
  loadStylesheet(ICON_STYLESHEET, "vividHomeIcons");

  // Ambient effects and the video billboard must not compete with the first
  // catalogue render. They remain enabled and initialise after the first frame.
  void import("./atmosphere.js").catch(error => console.warn("Vivid atmosphere unavailable:", error));
  void import("./home-breathe.js").catch(error => console.warn("Vivid ambient artwork unavailable:", error));
  void import("./tflix-hero.js?v=hero-fast-fallback-1").catch(error => console.warn("Vivid hero unavailable:", error));
}

requestAnimationFrame(() => {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadEnhancements, { timeout: 1400 });
  } else {
    window.setTimeout(loadEnhancements, 700);
  }
});
