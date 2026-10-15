import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const about = readFileSync(new URL("../about.html", import.meta.url), "utf8");
const title = readFileSync(new URL("../scripts/title.js", import.meta.url), "utf8");

test("About page uses an official TMDB logo and the required non-endorsement notice", () => {
  assert.match(about, /themoviedb\.org\/assets\/2\/v4\/logos\/v2\/blue_square_2-/);
  assert.match(about, /alt="TMDB logo"/);
  assert.match(about, /This product uses the TMDB API but is not endorsed or certified by TMDB\./);
  assert.match(about, /themoviedb\.org\/about\/logos-attribution/);
});

test("provider availability surfaces identify JustWatch as the source via TMDB", () => {
  assert.match(title, /Availability data source: <a href="https:\/\/www\.justwatch\.com\/"[^>]*>JustWatch<\/a> via <a href="https:\/\/www\.themoviedb\.org\/"[^>]*>TMDB<\/a>/);
  assert.match(title, /Streaming availability data is provided by <a href="https:\/\/www\.justwatch\.com\/"[^>]*>JustWatch<\/a> via <a href="https:\/\/www\.themoviedb\.org\/"[^>]*>TMDB<\/a>/);
});
