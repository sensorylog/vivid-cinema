export const VIVID_CONFIG = Object.freeze({
  appName: "Vivid Cinema",
  api: Object.freeze({
    tmdbBaseUrl: "https://api.themoviedb.org/3",
    tmdbImageBaseUrl: "https://image.tmdb.org/t/p",
    tmdbApiKey: "6a46c44a2b36f3b6c206e5f19cafa558",
    yenimeEmbedBaseUrl: "https://api.yenime.net",
    jikanBaseUrl: "https://api.jikan.moe/v4",
    animapBaseUrl: "https://animap.id",
    vidapiEmbedBaseUrl: "https://vaplayer.ru",
    vidsrcEmbedBaseUrl: "https://vidsrc.sh",
    vidlinkEmbedBaseUrl: "https://vidlink.pro",
    vidplusEmbedBaseUrl: "https://player.vidplus.to",
    // Cloudflare Worker URL for silent OpenRouter fallback.
    // The OpenRouter API key stays server-side as a Worker secret.
    plotAiFallbackUrl: "https://vivid-cinema.johnkyei221.workers.dev",
    // Add exact HTTPS hostnames only after verifying an authorized direct-stream provider.
    directStreamHosts: Object.freeze([]),
    language: "en-US"
  }),
  routes: Object.freeze({
    home: "home.html",
    title: "title.html",
    watch: "watch.html",
    discover: "discover.html",
    forYou: "for-you.html",
    live: "live.html",
    anime: "anime.html",
    collection: "collection.html",
    library: "library.html",
    login: "login.html",
    signup: "auth.html",
    account: "account.html"
  })
});