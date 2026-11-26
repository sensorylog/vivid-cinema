/**
 * Shared TMDB anime eligibility rules for discovery and protected playback.
 * Require animation metadata plus a Japanese-language or Japan-origin signal.
 */
export function isAnimeMetadata(item = {}) {
  const genres = Array.isArray(item.genres) ? item.genres : Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const hasAnimation = genres.some(genre => Number(typeof genre === "object" ? genre?.id : genre) === 16);
  const language = String(item.original_language || "").trim().toLowerCase();
  const countries = [
    ...(Array.isArray(item.origin_country) ? item.origin_country : []),
    ...(Array.isArray(item.production_countries) ? item.production_countries.map(country => country?.iso_3166_1) : [])
  ].map(value => String(value || "").trim().toUpperCase());
  return hasAnimation && (language === "ja" || countries.includes("JP"));
}
