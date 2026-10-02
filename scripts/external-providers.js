// Explicit external download-page links for titles Vivid is authorized to link to.
// Keep this list manually curated. Vivid never fetches, proxies, generates, or transforms
// third-party file/download URLs. Store the provider's stable public page, not a temporary
// direct-file URL.
//
// Movie key: TMDB movie ID as a string.
// TV key: TMDB TV ID -> season number -> episode number.
//
// Keep provider destinations out of the UI until a complete, authorized public page URL
// has been verified. This prevents dead/temporary links from leaking into the product.
const EXTERNAL_PROVIDER_LINKS = Object.freeze({
  // TMDB IDs are preferred. IMDb IDs are supported as a fallback because some
  // external catalogues identify titles by IMDb rather than TMDB.
  movie: Object.freeze({}),
  tv: Object.freeze({}),
  movieImdb: Object.freeze({
    "tt35682658": "https://loadedfiles.net/d4d7aa45dba9038a/Infirmary.2026.540p.X265.AAC.[9jaRocks.Com].mkv"
  })
});

function safeExternalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function getExternalProviderLink(media) {
  if (!media) return "";
  const type = media.media_type === "tv" ? "tv" : "movie";
  const direct = media.id ? EXTERNAL_PROVIDER_LINKS[type]?.[String(media.id)] : "";
  const imdbId = media.imdb_id || media.external_ids?.imdb_id || "";
  const imdbFallback = type === "movie" && imdbId
    ? EXTERNAL_PROVIDER_LINKS.movieImdb?.[String(imdbId)]
    : "";
  return safeExternalUrl(direct || imdbFallback);
}

export function getExternalEpisodeLink(media, seasonNumber, episodeNumber) {
  if (!media?.id || media.media_type !== "tv") return "";
  const season = String(Number(seasonNumber));
  const episode = String(Number(episodeNumber));
  if (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode))) return "";
  return safeExternalUrl(EXTERNAL_PROVIDER_LINKS.tv?.[String(media.id)]?.[season]?.[episode]);
}
