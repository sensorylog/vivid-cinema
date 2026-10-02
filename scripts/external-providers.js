// Explicit external-provider links for titles Vivid is authorized to link to.
// Keep this list manually curated. Vivid does not fetch, proxy, generate, or transform
// third-party file/download URLs.
const EXTERNAL_PROVIDER_LINKS = Object.freeze({
  movie: Object.freeze({}),
  tv: Object.freeze({})
});

export function getExternalProviderLink(media) {
  if (!media?.id) return "";
  return EXTERNAL_PROVIDER_LINKS[media.media_type === "tv" ? "tv" : "movie"]?.[String(media.id)] || "";
}
