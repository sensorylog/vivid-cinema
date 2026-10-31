const VIDEO_FILE_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv)$/i;

export function normalizeAllowedHosts(hosts) {
  if (!Array.isArray(hosts)) return [];
  return [...new Set(hosts.flatMap(value => {
    const host = String(value ?? "").trim().toLowerCase();
    if (!host || /[/:?#@\s]/.test(host)) return [];
    try {
      const parsed = new URL("https://" + host);
      if (parsed.hostname !== host || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return [];
      return [host.startsWith("*.") ? "*." + parsed.hostname.slice(2) : parsed.hostname];
    } catch {
      return [];
    }
  }))];
}

export function validateAllowedHttpsUrl(value, hosts) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const allowed = normalizeAllowedHosts(hosts);
  const hostname = url.hostname.toLowerCase();
  if (!allowed.some(host => host.startsWith("*.") ? hostname.endsWith("." + host.slice(2)) && hostname !== host.slice(2) : host === hostname)) return null;
  return url;
}

export function createAllowlistedFetchRequest(value, initParams, hosts) {
  const url = validateAllowedHttpsUrl(value, hosts);
  if (!url) throw new Error("HLS resource host is not allowlisted.");
  return new Request(url.href, { ...(initParams || {}), redirect: "error" });
}

export function inferAuthorizedStreamType(url, declaredType) {
  const type = String(declaredType || "").toLowerCase();
  if (["hls", "dash", "file"].includes(type)) return type;
  const pathname = String(url?.pathname || "").toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mpd")) return "dash";
  if (VIDEO_FILE_EXTENSIONS.test(pathname)) return "file";
  return "";
}
