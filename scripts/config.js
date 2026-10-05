export const VIVID_CONFIG = Object.freeze({
  appName: "Vivid Cinema",
  api: Object.freeze({
    tmdbBaseUrl: "https://api.themoviedb.org/3",
    tmdbImageBaseUrl: "https://image.tmdb.org/t/p",
    tmdbApiKey: "6a46c44a2b36f3b6c206e5f19cafa558",
    vidapiEmbedBaseUrl: "https://vaplayer.ru",
    vidsrcEmbedBaseUrl: "https://vidsrc.cc",
    language: "en-US"
  }),
  routes: Object.freeze({
    home: "home.html",
    title: "title.html",
    watch: "watch.html",
    discover: "discover.html",
    collection: "collection.html",
    library: "library.html",
    login: "login.html",
    signup: "auth.html",
    account: "account.html"
  })
});
