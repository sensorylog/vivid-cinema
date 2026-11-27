const CLOUDFLARE_API_ORIGIN = "https://vivid-cinema.pages.dev";

export function getCloudflareApiUrl(path) {
  const pathname = String(path || "");
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new TypeError("Cloudflare API paths must be absolute same-site paths.");
  }
  let origin = typeof window !== "undefined" ? window.location.origin : CLOUDFLARE_API_ORIGIN;
  try {
    const capacitor = typeof window !== "undefined" ? window.Capacitor : null;
    const nativeApp = capacitor?.isNativePlatform?.() === true;
    const electronApp = typeof window !== "undefined" && window.vividDownloads?.available === true;
    if (nativeApp || electronApp) {
      // Native WebViews and Electron serve bundled assets from local origins.
      // Their authenticated API calls must reach the real Cloudflare Pages host.
      origin = CLOUDFLARE_API_ORIGIN;
    }
  } catch {}
  return new URL(pathname, origin).toString();
}
