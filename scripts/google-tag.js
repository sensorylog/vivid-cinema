// Site-wide GA4 Google tag. Loaded independently from Firebase Analytics so page tracking
// is not delayed when Firebase configuration or Analytics support is unavailable.
const GOOGLE_ANALYTICS_ID = "G-TKXLVSEFL4";
if (typeof window !== "undefined" && !window.__vividGtagLoaded) {
  window.__vividGtagLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_ANALYTICS_ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + GOOGLE_ANALYTICS_ID;
  document.head.appendChild(script);
}
