import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVidapiEmbedUrl,
  buildVidsrcEmbedUrl,
  buildVidlinkEmbedUrl,
  buildVidplusEmbedUrl,
  buildVidkingEmbedUrl
} from "../scripts/playback-urls.js";

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

test("VidLink uses TMDB IDs for standard content and MAL IDs for anime", () => {
  assert.equal(buildVidlinkEmbedUrl(movie, { tmdbId: "27205" }), "https://vidlink.pro/movie/27205?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false");
  assert.equal(buildVidlinkEmbedUrl(tv, { tmdbId: "1399", startAt: 90 }), "https://vidlink.pro/tv/1399/2/7?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false&startAt=90");
  assert.equal(buildVidlinkEmbedUrl({ ...tv, episode: 3 }, { anime: true, malId: "21" }), "https://vidlink.pro/anime/21/3/sub?primaryColor=e50914&secondaryColor=1b1b1b&iconColor=ffffff&title=false&poster=false&fallback=true");
  assert.equal(buildVidlinkEmbedUrl(movie, { imdbId: "tt0133093" }), "");
});

test("VidPlus uses TMDB for movies/TV, AniList for anime, and progress for resume", () => {
  assert.equal(buildVidplusEmbedUrl(movie, { tmdbId: "27205" }), "https://player.vidplus.to/embed/movie/27205?autoplay=false&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff");
  assert.equal(buildVidplusEmbedUrl(tv, { tmdbId: "1399", startAt: 600 }), "https://player.vidplus.to/embed/tv/1399/2/7?autoplay=false&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff&progress=600");
  assert.equal(buildVidplusEmbedUrl({ ...tv, episode: 3 }, { anime: true, aniListId: "21" }), "https://player.vidplus.to/embed/anime/21/3?autoplay=false&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff&dub=false");
  assert.equal(buildVidplusEmbedUrl(movie, { imdbId: "tt0133093" }), "");
});

test("VidKing uses TMDB embed routes and its documented progress parameter", () => {
  assert.equal(buildVidkingEmbedUrl(movie, { tmdbId: "27205" }), "https://www.vidking.net/embed/movie/27205?color=e50914&autoPlay=false");
  assert.equal(buildVidkingEmbedUrl(tv, { tmdbId: "1399", startAt: 120 }), "https://www.vidking.net/embed/tv/1399/2/7?color=e50914&autoPlay=false&progress=120");
  assert.equal(buildVidkingEmbedUrl({ ...movie, id: "tt0133093" }), "");
});
