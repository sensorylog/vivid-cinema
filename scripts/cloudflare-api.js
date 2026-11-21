const ANDROID_CLOUDFLARE_API_ORIGIN = "https://vivid-cinema.pages.dev";

export function getCloudflareApiUrl(path) {
  const pathname = String(path || "");
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new TypeError("Cloudflare API paths must be absolute same-site paths.");
  }
  let origin = typeof window !== "undefined" ? window.location.origin : ANDROID_CLOUDFLARE_API_ORIGIN;
  try {
    const capacitor = typeof window !== "undefined" ? window.Capacitor : null;
    if (capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() === "android") {
      // Capacitor serves the bundled UI from its local WebView origin. Cloudflare
      // APIs must be called on the real Pages origin, not localhost.
      origin = ANDROID_CLOUDFLARE_API_ORIGIN;
    }
  } catch {}
  return new URL(pathname, origin).toString();
}
