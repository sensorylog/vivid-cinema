import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key)
};

const source = readFileSync(new URL("../scripts/playback-servers.js", import.meta.url), "utf8");
const api = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test.beforeEach(() => values.clear());

test("saves a custom HTTPS server and builds movie and episode URLs", () => {
  const id = api.saveCustomPlaybackServer({
    name: "My Server",
    url: "https://media.example/embed"
  });
  const server = api.getCustomPlaybackServer(id);
  assert.ok(server);
  assert.equal(
    api.buildCustomEmbedUrl(server, { type: "movie", tmdbId: 42, title: "A Test Movie" }),
    "https://media.example/embed/movie/42?autoplay=true"
  );
  assert.equal(
    api.buildCustomEmbedUrl(server, { type: "tv", tmdbId: 42, season: 2, episode: 7, title: "A Test Show" }),
    "https://media.example/embed/tv/42/2/7?autoplay=true"
  );
});

test("rejects insecure base URLs and URL patterns that leave the configured origin", () => {
  assert.throws(() => api.saveCustomPlaybackServer({
    name: "Insecure",
    url: "http://media.example"
  }), /HTTPS/);
  assert.throws(() => api.saveCustomPlaybackServer({
    name: "Cross origin",
    url: "https://media.example",
    movieUrlPattern: "https://elsewhere.example/{url}/movie/{tmdbId}"
  }), /same HTTPS origin/);
});

test("supports explicit patterns and safe slug placeholders", () => {
  const id = api.saveCustomPlaybackServer({
    name: "Slug Server",
    url: "https://media.example",
    movieUrlPattern: "{url}/watch/{tmdbId}-{slug}?play=true",
    tvUrlPattern: "{url}/series/{tmdbId}/{season}/{episode}?title={slug}"
  });
  const server = api.getCustomPlaybackServer(id);
  assert.equal(
    api.buildCustomEmbedUrl(server, { type: "movie", tmdbId: 88, title: "Café Nights" }),
    "https://media.example/watch/88-cafe-nights?play=true"
  );
  assert.equal(
    api.buildCustomEmbedUrl(server, { type: "tv", tmdbId: 88, season: 1, episode: 3, title: "Café Nights" }),
    "https://media.example/series/88/1/3?title=cafe-nights"
  );
});

test("limits saved servers to ten and removes a server by ID", () => {
  const ids = [];
  for (let i = 1; i <= 10; i += 1) {
    ids.push(api.saveCustomPlaybackServer({ name: "Server " + i, url: "https://media" + i + ".example" }));
  }
  assert.equal(api.listCustomPlaybackServers().length, 10);
  assert.throws(() => api.saveCustomPlaybackServer({ name: "Server 11", url: "https://media11.example" }), /up to 10/);
  assert.equal(api.removeCustomPlaybackServer(ids[0]), true);
  assert.equal(api.getCustomPlaybackServer(ids[0]), null);
});
