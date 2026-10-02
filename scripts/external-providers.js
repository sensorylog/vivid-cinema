// Authorized external download-page integration point.
//
// Vivid does not host, proxy, scrape, generate, or transform third-party
// movie/episode download URLs. A provider can be integrated here only when it
// exposes an authorized, documented catalogue/API that Vivid is permitted to
// query and link to.
//
// Keep temporary file-host URLs and manually hard-coded title URLs out of the
// application. Provider-specific resolution belongs behind a documented API.

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
  // No provider is currently configured with a documented authorized API.
  // Returning an empty value keeps the Download action hidden instead of
  // presenting stale or fabricated links.
  void media;
  return safeExternalUrl("");
}

export function getExternalEpisodeLink(media, seasonNumber, episodeNumber) {
  void media;
  void seasonNumber;
  void episodeNumber;
  return safeExternalUrl("");
}
