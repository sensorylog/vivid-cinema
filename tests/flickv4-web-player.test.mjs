import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildServerUrl } from "../scripts/flickv4-web-player.js";

test("builds valid movie embed URLs for each second-player provider", () => {
  assert.match(buildServerUrl("vidlink", { type: "movie", id: 550 }), /^https:\/\/vidlink\.pro\/movie\/550\?/);
  assert.equal(buildServerUrl("vidsrc", { type: "movie", id: 550 }), "https://vidsrc.sh/embed/movie/550");
  assert.match(buildServerUrl("vidplus", { type: "movie", id: 550 }), /^https:\/\/player\.vidplus\.to\/embed\/movie\/550\?/);
  assert.equal(buildServerUrl("vidking", { type: "movie", id: 550 }), "https://www.vidking.net/embed/movie/550?color=e50914&autoplay=false");
});

test("preserves TV season and episode in all provider routes", () => {
  assert.match(buildServerUrl("vidlink", { type: "tv", id: 1399, season: 2, episode: 3 }), /^https:\/\/vidlink\.pro\/tv\/1399\/2\/3\?/);
  assert.equal(buildServerUrl("vidsrc", { type: "tv", id: 1399, season: 2, episode: 3 }), "https://vidsrc.sh/embed/tv/1399/2/3");
  assert.match(buildServerUrl("vidplus", { type: "tv", id: 1399, season: 2, episode: 3 }), /^https:\/\/player\.vidplus\.to\/embed\/tv\/1399\/2\/3\?/);
  assert.equal(buildServerUrl("vidking", { type: "tv", id: 1399, season: 2, episode: 3 }), "https://www.vidking.net/embed/tv/1399/2/3?color=e50914&autoplay=false");
});

test("passes resume time where supported and rejects unsafe IDs", () => {
  assert.match(buildServerUrl("vidlink", { type: "movie", id: 550, startAt: 120 }), /startAt=120/);
  assert.match(buildServerUrl("vidsrc", { type: "tv", id: 1399, season: 1, episode: 4, startAt: 300 }), /startAt=300/);
  assert.match(buildServerUrl("vidplus", { type: "movie", id: 550, startAt: 60 }), /startAt=60/);
  assert.equal(buildServerUrl("vidlink", { type: "movie", id: "550/evil" }), "");
  assert.equal(buildServerUrl("unknown", { type: "movie", id: 550 }), "");
});

test("Firebase policies allow providers offered by the player controls", () => {
  const firebase = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
  const headers = firebase.hosting.headers.flatMap(entry => entry.headers || []);
  const csp = headers.find(header => header.key === "Content-Security-Policy")?.value || "";
  const permissions = headers.find(header => header.key === "Permissions-Policy")?.value || "";
  const origins = ["https://vaplayer.ru","https://vidapi.ru","https://vidsrc.sh","https://vidlink.pro","https://player.vidplus.to","https://www.vidking.net"];
  const frameSrc = csp.match(/(?:^|;\s*)frame-src\s+([^;]+)/)?.[1] || "";
  for (const origin of origins) {
    assert.ok(frameSrc.includes(origin), "CSP frame-src missing " + origin);
    assert.ok(permissions.includes(origin), "Permissions-Policy missing " + origin);
  }
});
