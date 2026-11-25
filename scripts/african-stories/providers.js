const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
const ARCHIVE_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,239}$/;
const PUBLIC_ARCHIVE_FORMATS = new Set(["MPEG4","h.264","H.264","WebM","Ogg Video","Ogg Video File"]);
const FILMFLUX_ENDPOINT = "https://filmflux.app/api/public/trending?limit=20";
const PEERTUBE_ALLOWED_HOSTS = new Set(["framatube.org", "peer.tube"]);

function cleanText(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeHttpsUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      allowedHosts.some(host => url.hostname === host || url.hostname.endsWith("." + host))
      ? url : null;
  } catch { return null; }
}

export function validateAfricanPlaybackSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source) || source.enabled !== true) {
    throw new TypeError("This playback source is not enabled by the published catalogue.");
  }
  const provider = source.provider;
  if (!["youtube","vimeo","peertube","archive"].includes(provider)) {
    throw new TypeError("Unsupported African Stories playback provider.");
  }
  const sourceId = cleanText(source.sourceId, 80);
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceId)) throw new TypeError("Invalid playback source identifier.");
  return { ...source, sourceId, provider };
}

export function buildOfficialEmbed(source, { origin = globalThis.location?.origin || "https://vivid-cinema.example" } = {}) {
  const item = validateAfricanPlaybackSource(source);
  const referrerOrigin = new URL(origin).origin;
  if (item.provider === "youtube") {
    if (!YOUTUBE_ID.test(item.videoId || "")) throw new TypeError("Invalid YouTube video ID.");
    const url = new URL("https://www.youtube-nocookie.com/embed/" + item.videoId);
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", referrerOrigin);
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("rel", "0");
    return { provider: item.provider, url: url.toString(), origin: url.origin, title: cleanText(item.label) || "Official YouTube player" };
  }
  if (item.provider === "vimeo") {
    if (!VIMEO_ID.test(item.videoId || "")) throw new TypeError("Invalid Vimeo video ID.");
    const url = new URL("https://player.vimeo.com/video/" + item.videoId);
    if (item.vimeoHash) {
      if (!/^[A-Za-z0-9]{6,80}$/.test(item.vimeoHash)) throw new TypeError("Invalid Vimeo privacy hash.");
      url.searchParams.set("h", item.vimeoHash);
    }
    url.searchParams.set("dnt", "1");
    return { provider: item.provider, url: url.toString(), origin: url.origin, title: cleanText(item.label) || "Official Vimeo player" };
  }
  if (item.provider === "peertube") {
    const instance = safeHttpsUrl(item.instanceOrigin, []);
    if (!instance || instance.pathname !== "/" || instance.search || instance.hash ||
        !/^[a-z0-9.-]+$/i.test(instance.hostname) || instance.hostname.includes("..") ||
        instance.hostname === "localhost" || instance.hostname.endsWith(".local")) {
      throw new TypeError("Invalid PeerTube instance origin.");
    }
    if (!UUID.test(item.videoUuid || "")) throw new TypeError("Invalid PeerTube video UUID.");
    const url = new URL("/videos/embed/" + item.videoUuid, instance.origin);
    url.searchParams.set("api", "1");
    return { provider: item.provider, url: url.toString(), origin: url.origin, title: cleanText(item.label) || "PeerTube player" };
  }
  throw new TypeError("This source is not an official platform embed.");
}

export async function resolveInternetArchiveFile(source, fetchImpl = fetch) {
  const item = validateAfricanPlaybackSource(source);
  if (item.provider !== "archive") throw new TypeError("Not an Internet Archive source.");
  if (!ARCHIVE_ID.test(item.archiveIdentifier || "") || item.archiveIdentifier.includes("..")) {
    throw new TypeError("Invalid Internet Archive item identifier.");
  }
  if (!ARCHIVE_FILE.test(item.archiveFile || "") || item.archiveFile.includes("..")) {
    throw new TypeError("Invalid Internet Archive filename.");
  }
  const metadataUrl = "https://archive.org/metadata/" + encodeURIComponent(item.archiveIdentifier);
  const response = await fetchImpl(metadataUrl, { headers: { Accept: "application/json" }, credentials: "omit" });
  if (!response.ok) throw new Error("Internet Archive item metadata is unavailable.");
  const metadata = await response.json();
  const file = Array.isArray(metadata.files) ? metadata.files.find(entry => entry.name === item.archiveFile) : null;
  if (!file || file.private === "true" || !PUBLIC_ARCHIVE_FORMATS.has(file.format)) {
    throw new Error("The selected file is not a supported public video file in this archive item.");
  }
  const extension = item.archiveFile.toLowerCase().split(".").pop();
  if (!["mp4","webm","ogv","ogg","m3u8"].includes(extension)) {
    throw new Error("The selected archive file format is not supported by the browser player.");
  }
  const url = new URL("/download/" + encodeURIComponent(item.archiveIdentifier) + "/" + encodeURIComponent(item.archiveFile), "https://archive.org");
  return {
    provider: "archive",
    url: url.toString(),
    origin: url.origin,
    title: cleanText(item.label) || "Internet Archive",
    mimeType: extension === "m3u8" ? "application/vnd.apple.mpegurl" :
      extension === "webm" ? "video/webm" : extension === "ogv" || extension === "ogg" ? "video/ogg" : "video/mp4",
    itemUrl: "https://archive.org/details/" + encodeURIComponent(item.archiveIdentifier),
    rightsBasis: cleanText(item.rightsBasis, 80),
    evidenceRef: cleanText(item.evidenceRef, 240)
  };
}

export async function fetchFilmFluxTrending(fetchImpl = fetch) {
  const response = await fetchImpl(FILMFLUX_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    cache: "no-store"
  });
  if (!response.ok) throw new Error("FilmFlux discovery is temporarily unavailable.");
  const payload = await response.json();
  if (!Array.isArray(payload.movies)) throw new Error("FilmFlux returned an unexpected catalogue response.");
  return payload.movies.slice(0, 20).map((movie, index) => {
    const youtubeId = typeof movie.youtube_id === "string" && YOUTUBE_ID.test(movie.youtube_id) ? movie.youtube_id : "";
    const filmUrl = safeHttpsUrl(movie.url, ["filmflux.app"]);
    const thumbnailUrl = safeHttpsUrl(movie.thumbnail, ["filmflux.app","ytimg.com","googleusercontent.com"]);
    return {
      id: youtubeId || "filmflux-" + index,
      title: cleanText(movie.title, 240) || "Untitled film",
      description: cleanText(movie.description, 500),
      channel: cleanText(movie.channel, 160),
      duration: cleanText(movie.duration, 40),
      youtubeId,
      filmUrl: filmUrl?.toString() || "https://filmflux.app/",
      thumbnailUrl: thumbnailUrl?.toString() || ""
    };
  });
}

export function getOfficialSourceFallback(source) {
  try {
    const item = validateAfricanPlaybackSource(source);
    if (item.provider === "youtube" && YOUTUBE_ID.test(item.videoId || "")) return "https://www.youtube.com/watch?v=" + item.videoId;
    if (item.provider === "vimeo" && VIMEO_ID.test(item.videoId || "")) return "https://vimeo.com/" + item.videoId;
    if (item.provider === "peertube") return buildOfficialEmbed(item).url.replace("/videos/embed/", "/videos/watch/");
    if (item.provider === "archive" && ARCHIVE_ID.test(item.archiveIdentifier || "")) return "https://archive.org/details/" + encodeURIComponent(item.archiveIdentifier);
  } catch {}
  return "";
}
