import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficialEmbed, fetchFilmFluxTrending, getOfficialSourceFallback,
  resolveInternetArchiveFile, validateAfricanPlaybackSource
} from "../scripts/african-stories/providers.js";

const base = { sourceId: "source-one", enabled: true, label: "Test source", evidenceRef: "editorial-record-1" };

test("YouTube uses the official embedded player and validates the video ID", () => {
  const result = buildOfficialEmbed({ ...base, provider: "youtube", videoId: "M7lc1UVf-VE" }, { origin: "https://vivid.example" });
  const url = new URL(result.url);
  assert.equal(url.origin, "https://www.youtube-nocookie.com");
  assert.equal(url.pathname, "/embed/M7lc1UVf-VE");
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(url.searchParams.get("origin"), "https://vivid.example");
  assert.throws(() => buildOfficialEmbed({ ...base, provider: "youtube", videoId: "bad-id" }), /Invalid YouTube/);
});

test("Vimeo official embed preserves an unlisted privacy hash", () => {
  const result = buildOfficialEmbed({ ...base, provider: "vimeo", videoId: "12345678", vimeoHash: "abc123hash" });
  const url = new URL(result.url);
  assert.equal(url.origin, "https://player.vimeo.com");
  assert.equal(url.searchParams.get("h"), "abc123hash");
  assert.equal(url.searchParams.get("dnt"), "1");
});

test("PeerTube embed is restricted to reviewed instance origins", () => {
  const result = buildOfficialEmbed({
    ...base, provider: "peertube", instanceOrigin: "https://peer.tube",
    videoUuid: "52a10666-3a18-4e73-93da-e8d3c12c305a"
  });
  assert.equal(new URL(result.url).origin, "https://peer.tube");
  assert.equal(new URL(result.url).pathname, "/videos/embed/52a10666-3a18-4e73-93da-e8d3c12c305a");
  assert.throws(() => buildOfficialEmbed({
    ...base, provider: "peertube", instanceOrigin: "https://unreviewed.example",
    videoUuid: "52a10666-3a18-4e73-93da-e8d3c12c305a"
  }), /Invalid PeerTube instance/);
});

test("Internet Archive resolves only the exact public supported file", async () => {
  let requested = "";
  const resolved = await resolveInternetArchiveFile({
    ...base, provider: "archive", archiveIdentifier: "ghana-film-archive-001",
    archiveFile: "film.mp4", rightsBasis: "written_permission"
  }, async url => {
    requested = url;
    return { ok: true, json: async () => ({ files: [
      { name: "private.mp4", format: "MPEG4", private: "true" },
      { name: "film.mp4", format: "MPEG4", size: "1024" }
    ] }) };
  });
  assert.match(requested, /archive\.org\/metadata/);
  assert.equal(resolved.url, "https://archive.org/download/ghana-film-archive-001/film.mp4");
  assert.equal(resolved.mimeType, "video/mp4");
  assert.equal(resolved.rightsBasis, "written_permission");
});

test("Internet Archive rejects private files and path traversal", async () => {
  const source = {
    ...base, provider: "archive", archiveIdentifier: "ghana-film-archive-001",
    archiveFile: "private.mp4", rightsBasis: "public_domain"
  };
  await assert.rejects(resolveInternetArchiveFile(source, async () => ({
    ok: true, json: async () => ({ files: [{ name: "private.mp4", format: "MPEG4", private: "true" }] })
  })), /not a supported public video file/);
  await assert.rejects(resolveInternetArchiveFile({ ...source, archiveFile: "../secret.mp4" }), /Invalid Internet Archive filename/);
});

test("FilmFlux discovery normalizes records and ignores unsafe URLs or malformed video IDs", async () => {
  const movies = await fetchFilmFluxTrending(async url => {
    assert.match(url, /filmflux\.app\/api\/public\/trending/);
    return {
      ok: true,
      json: async () => ({ movies: [
        { title: "African Cinema", youtube_id: "M7lc1UVf-VE", channel: "Official channel",
          url: "https://filmflux.app/movie/1", thumbnail: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg" },
        { title: "Unverified link", youtube_id: "invalid", url: "https://evil.example/movie", thumbnail: "javascript:alert(1)" }
      ] })
    };
  });
  assert.equal(movies.length, 2);
  assert.equal(movies[0].youtubeId, "M7lc1UVf-VE");
  assert.equal(movies[0].filmUrl, "https://filmflux.app/movie/1");
  assert.equal(movies[0].thumbnailUrl, "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg");
  assert.equal(movies[1].youtubeId, "");
  assert.equal(movies[1].filmUrl, "https://filmflux.app/");
  assert.equal(movies[1].thumbnailUrl, "");
});

test("disabled and malformed catalogue sources cannot be played", () => {
  assert.throws(() => validateAfricanPlaybackSource({ ...base, enabled: false, provider: "youtube" }), /not enabled/);
  assert.throws(() => validateAfricanPlaybackSource({ ...base, provider: "unknown" }), /Unsupported/);
  assert.equal(getOfficialSourceFallback({ ...base, provider: "youtube", videoId: "M7lc1UVf-VE" }), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
});
