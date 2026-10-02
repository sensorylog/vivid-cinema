// Explicit external download-page links for titles Vivid is authorized to link to.
// Keep this list manually curated. Vivid never fetches, proxies, generates, or transforms
// third-party file/download URLs. Store the provider's stable public page, not a temporary
// direct-file URL. The UI remains Vivid-branded; the external destination is opened directly.
const EXTERNAL_PROVIDER_LINKS = Object.freeze({
  movie: Object.freeze({}),
  tv: Object.freeze({})
});

export function getExternalProviderLink(media) {
  if (!media?.id) return "";
  return EXTERNAL_PROVIDER_LINKS[media.media_type === "tv" ? "tv" : "movie"]?.[String(media.id)] || "";
}
