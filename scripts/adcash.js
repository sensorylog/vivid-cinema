// Sitewide Adcash Autotag integration. Keep the provider library and zone init in one place.
const ADCASH_ZONE_ID = "qj1fxyobo";
const ADCASH_LIBRARY_URL = "https://acscdn.com/script/aclib.js";

const isWatchPage = () =>
  document.body?.dataset?.vividPage === "watch" ||
  /(?:^|\/)watch\.html$/.test(window.location.pathname);

// The watch/player experience is intentionally excluded from this first rollout.
if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !isWatchPage() &&
  !window.__vividAdcashAutotagStarted
) {
  window.__vividAdcashAutotagStarted = true;

  const library = document.createElement("script");
  library.id = "aclib";
  library.type = "text/javascript";
  library.src = ADCASH_LIBRARY_URL;
  library.async = true;

  library.addEventListener("load", () => {
    if (window.aclib && typeof window.aclib.runAutoTag === "function") {
      window.aclib.runAutoTag({ zoneId: ADCASH_ZONE_ID });
    } else {
      window.__vividAdcashAutotagStarted = false;
      console.warn("Adcash library loaded without the Autotag API.");
    }
  }, { once: true });

  library.addEventListener("error", () => {
    window.__vividAdcashAutotagStarted = false;
    console.warn("Adcash Autotag library could not be loaded.");
  }, { once: true });

  document.head.appendChild(library);
}
