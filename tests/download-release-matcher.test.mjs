import test from "node:test";
import assert from "node:assert/strict";
import { matchesSelectedRelease } from "../scripts/downloads/release-matcher.js";

test("movie matching requires the selected title phrase and exact release year", () => {
  const odyssey = { id: 999, media_type: "movie", title: "The Odyssey", year: "2026" };
  assert.equal(matchesSelectedRelease(odyssey, { title: "The.Odyssey.2026.1080p.WEB-DL" }), true);
  assert.equal(matchesSelectedRelease(odyssey, { title: "YTS.MX.The.Odyssey.2026.1080p.WEB-DL" }), true);
  assert.equal(matchesSelectedRelease(odyssey, { title: "The Odyssey 1997 1080p" }), false);
  assert.equal(matchesSelectedRelease(odyssey, { title: "An Odyssey of Space 2026 1080p" }), false);
  assert.equal(matchesSelectedRelease(odyssey, { title: "The Odyssey 1080p" }), false);
});

test("movie matching handles punctuation without accepting title fragments", () => {
  const spiderMan = { id: 123, media_type: "movie", title: "Spider-Man: Homecoming", year: "2017" };
  assert.equal(matchesSelectedRelease(spiderMan, { title: "Spider.Man.Homecoming.2017.1080p" }), true);
  assert.equal(matchesSelectedRelease(spiderMan, { title: "Spider.Man.2002.1080p" }), false);
  assert.equal(matchesSelectedRelease(spiderMan, { title: "Spider.Man.Fan.Edit.2017.1080p" }), false);
});

test("episode matching requires exact series title and season/episode coordinates", () => {
  const episode = { id: 1399, media_type: "tv", title: "Game of Thrones", season: 1, episode: 5 };
  assert.equal(matchesSelectedRelease(episode, { title: "Game.of.Thrones.S01E05.1080p" }), true);
  assert.equal(matchesSelectedRelease(episode, { title: "Game.of.Thrones.S01E06.1080p" }), false);
  assert.equal(matchesSelectedRelease(episode, { title: "Another.Game.of.Thrones.S01E05.1080p" }), false);
  assert.equal(matchesSelectedRelease(episode, { title: "Game.of.Thrones.1x05.1080p" }), true);
});

test("invalid or incomplete identities fail closed", () => {
  assert.equal(matchesSelectedRelease({ title: "The Odyssey", media_type: "movie" }, { title: "The Odyssey 2026" }), false);
  assert.equal(matchesSelectedRelease({ title: "Show", media_type: "tv", season: 1 }, { title: "Show S01E01" }), false);
});
