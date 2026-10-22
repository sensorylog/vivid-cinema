(() => {
  const hostname = window.location.hostname.toLowerCase();
  const userAgent = navigator.userAgent || "";
  const isFileBundle = window.location.protocol === "file:";
  const isCapacitorBundle = window.location.protocol === "capacitor:";
  const isAndroidAssetBundle = hostname === "appassets.androidplatform.net";
  const isNativeLoopbackBundle =
    ["localhost", "127.0.0.1"].includes(hostname) &&
    /(?:;\s*wv\)|\bCapacitor\b)/i.test(userAgent);
  const isNativeWebView = /(?:;\s*wv\)|\bCapacitor\b)/i.test(userAgent);
  const isUntrustedNativeOrigin = isNativeWebView &&
    !["vivid-cinema.web.app", "vivid-cinema.firebaseapp.com"].includes(hostname);

  // Local-file and native WebView origins cannot complete the deployed site's
  // reCAPTCHA Enterprise App Check flow. Move those wrappers to the trusted
  // Firebase Hosting origin before app modules initialize Firebase or Gemini.
  if (!isFileBundle && !isCapacitorBundle && !isAndroidAssetBundle && !isNativeLoopbackBundle && !isUntrustedNativeOrigin) return;

  const filename = window.location.pathname.split("/").pop() || "home.html";
  const page = /^[a-z0-9-]+\.html$/i.test(filename) ? filename : "home.html";
  const target = new URL(page, "https://vivid-cinema.web.app/");
  target.search = window.location.search;
  target.hash = window.location.hash;
  window.location.replace(target.href);
})();
