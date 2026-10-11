import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/media.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace(/^export function /gm, "function ");
const prelude = `
const VIVID_CONFIG = { routes: { title: "title.html" }, api: { tmdbImageBaseUrl: "https://image.tmdb.org/t/p" } };
const getMediaDate = item => item.release_date || item.first_air_date || "";
const getMediaTitle = item => item.title || item.name || "Untitled";
const getMediaType = item => item.media_type || (item.first_air_date ? "tv" : "movie");
`;
const moduleUrl = "data:text/javascript;base64," + Buffer.from(
  prelude + source + "\nexport { normalizeMedia, normalizeResults, getMediaUrl };"
).toString("base64");
const { normalizeMedia, normalizeResults, getMediaUrl } = await import(moduleUrl);

test('mixed-media "all" normalization preserves TV identity and ID', () => {
  const series = normalizeMedia({ id: 1399, media_type: "tv", name: "Example Series", first_air_date: "2011-04-17" }, "all");
  assert.equal(series.id, "1399");
  assert.equal(series.media_type, "tv");
  assert.equal(series.content_id, "tv:1399");
  assert.match(getMediaUrl(series), /id=1399/);
  assert.match(getMediaUrl(series), /type=tv/);
});

test('mixed-media normalization preserves movie identity', () => {
  const movie = normalizeMedia({ id:  129, media_type: "movie", title: "Example Movie", release_date: "2024-01-01" }, "all");
  assert.equal(movie.media_type, "movie");
  assert.equal(movie.content_id, "movie:" + String(129));
  assert.match(getMediaUrl(movie), /type=movie/);
});

test('explicit movie or TV endpoint types still take precedence', () => {
  assert.equal(normalizeMedia({ id: 7, media_type: "tv", name: "Series" }, "movie").media_type, "movie");
  assert.equal(normalizeMedia({ id: 8, title: "Film" }, "tv").media_type, "tv");
});

test('normalizeResults with "all" retains per-result media types', () => {
  const items = normalizeResults([
    { id: 1, media_type: "movie", title: "Film", release_date: "2020-01-01" },
    { id: 2, media_type: "tv", name: "Series", first_air_date: "2021-01-01" }
  ], "all");
  assert.deepEqual(items.map(item => item.media_type), ["movie", "tv"]);
});
