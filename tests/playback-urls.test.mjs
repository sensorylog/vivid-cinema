import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVidapiEmbedUrl,
  buildVidsrcEmbedUrl,
  buildVidlinkEmbedUrl,
  buildVidplusEmbedUrl,
  buildVidkingEmbedUrl,
  buildEmbedWaveUrl,
  buildVidFastUrl,
  buildEzVidApiUrl,
  buildEmbedApiStreamUrl,
  buildMoviesApiUrl
} from "../scripts/playback/playback-urls.js";

const movie = { id: "27205", type: "movie", season: 1, episode: 1 };
const tv = { id: "1399", type: "tv", season: 2, episode: 7 };

test("VidAPI uses documented movie and TV routes and its resumeAt parameter", () => {
  assert.equal(buildVidapiEmbedUrl(movie), "https://vaplayer.ru/embed/movie/27205?autoplay=1&controls=1&overlay=1");
  assert.equal(buildVidapiEmbedUrl(tv, { startAt: 300 }), "https://vaplayer.ru/embed/tv/1399/2/7?autoplay=1&controls=1&overlay=1&resumeAt=300");
  assert.match(buildVidapiEmbedUrl({ ...movie, id: "tt0133093" }), /\/embed\/movie\/tt0133093\?/);
});

test("VidSrc uses embed routes, English subtitle preference and startAt", () => {
  assert.equal(buildVidsrcEmbedUrl(movie), "https://vidsrc.sh/embed/movie/27205?ds_lang=en");
  assert.equal(buildVidsrcEmbedUrl(tv, { startAt: 125 }), "https://vidsrc.sh/embed/tv/1399/2/7?ds_lang=en&startAt=125");
  assert.equal(buildVidsrcEmbedUrl({ ...movie, id: "tt0133093" }), "https://vidsrc.sh/embed/movie/tt0133093?ds_lang=en");
});

test("VidLink uses TMDB IDs, enables autoplay, and supports MAL IDs for anime", () => {
  assert.equal(buildVidlinkEmbedUrl(movie, { tmdbId: "27205" }), "https://vidlink.pro/movie/27205?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false&autoplay=true");
  assert.equal(buildVidlinkEmbedUrl(tv, { tmdbId: "1399", startAt: 90 }), "https://vidlink.pro/tv/1399/2/7?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false&autoplay=true&startAt=90");
  assert.equal(buildVidlinkEmbedUrl({ ...tv, episode: 3 }, { anime: true, malId: "21" }), "https://vidlink.pro/anime/21/3/sub?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false&autoplay=true&fallback=true");
  assert.equal(buildVidlinkEmbedUrl({ ...movie, id: "tt0133093" }, { imdbId: "tt0133093" }), "");
});

test("VidPlus uses TMDB for movies/TV, AniList for anime, and enables autoplay", () => {
  assert.equal(buildVidplusEmbedUrl(movie, { tmdbId: "27205" }), "https://player.vidplus.to/embed/movie/27205?autoplay=true&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff");
  assert.equal(buildVidplusEmbedUrl(tv, { tmdbId: "1399", startAt: 600 }), "https://player.vidplus.to/embed/tv/1399/2/7?autoplay=true&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff&progress=600");
  assert.equal(buildVidplusEmbedUrl({ ...tv, episode: 3 }, { anime: true, aniListId: "21" }), "https://player.vidplus.to/embed/anime/21/3?autoplay=true&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff&dub=false");
  assert.equal(buildVidplusEmbedUrl({ ...movie, id: "tt0133093" }, { imdbId: "tt0133093" }), "");
});

test("VidKing uses TMDB embed routes, enables autoplay, and supports progress resume", () => {
  assert.equal(buildVidkingEmbedUrl(movie, { tmdbId: "27205" }), "https://www.vidking.net/embed/movie/27205?color=e50914&autoPlay=true");
  assert.equal(buildVidkingEmbedUrl(tv, { tmdbId: "1399", startAt: 120 }), "https://www.vidking.net/embed/tv/1399/2/7?color=e50914&autoPlay=true&progress=120");
  assert.equal(buildVidkingEmbedUrl({ ...movie, id: "tt0133093" }), "");
});



test("new movie/TV providers use documented movie and episode routes", () => {
  assert.equal(buildEmbedWaveUrl(movie, { tmdbId: "27205" }), "https://embedwave.cc/embed/movie/27205?autoplay=true");
  assert.equal(buildEmbedWaveUrl(tv, { tmdbId: "1399" }), "https://embedwave.cc/embed/tv/1399/2/7?autoplay=true");
  assert.equal(buildVidFastUrl(movie, { tmdbId: "27205" }), "https://vidfast.to/embed/movie/27205");
  assert.equal(buildVidFastUrl(tv, { imdbId: "tt0944947" }), "https://vidfast.to/embed/tv/tt0944947/2/7");
  assert.equal(buildEzVidApiUrl(movie, { tmdbId: "27205" }), "https://ezvidapi.com/embed/movie/27205");
  assert.equal(buildEzVidApiUrl(tv, { tmdbId: "1399" }), "https://ezvidapi.com/embed/tv/1399/2/7");
  assert.equal(buildEmbedApiStreamUrl(movie, { tmdbId: "27205" }), "https://watch.embed-api.stream/embed/movie/27205");
  assert.equal(buildEmbedApiStreamUrl(tv, { imdbId: "tt0944947" }), "https://watch.embed-api.stream/embed/tv/tt0944947/2/7");
  assert.equal(buildMoviesApiUrl(movie, { tmdbId: "27205" }), "https://moviesapi.to/movie/27205?theme=e50914");
  assert.equal(buildMoviesApiUrl(tv, { tmdbId: "1399", startAt: 125 }), "https://moviesapi.to/tv/1399/2/7?theme=e50914&t=125");
});
test("new providers reject missing IDs", () => {
  assert.equal(buildEmbedWaveUrl({ ...movie, id: "tt0133093" }), "");
  assert.equal(buildEzVidApiUrl({ ...movie, id: "tt0133093" }), "");
  assert.equal(buildVidFastUrl({ ...tv, id: "" }), "");
  assert.equal(buildMoviesApiUrl({ ...tv, id: "" }), "");
});
