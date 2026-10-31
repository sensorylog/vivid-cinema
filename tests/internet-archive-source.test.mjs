import test from "node:test";
import assert from "node:assert/strict";
import { createInternetArchiveSource } from "../scripts/downloads/internet-archive-source.js";

function response(data) { return { ok: true, redirected: false, async json() { return data; } }; }

test("Internet Archive search returns safe movie catalogue records", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async url => {
    assert.match(String(url), /advancedsearch\.php/);
    return response({ response: { docs: [{ identifier: "sample_film_1930", title: "Sample Film", year: "1930" }] } });
  }});
  const results = await source.search("sample film");
  assert.equal(results[0].identifier, "sample_film_1930");
  assert.equal(results[0].title, "Sample Film");
});

test("only declared public-domain or approved CC items expose direct video files", async () => {
  const metadata = {
    metadata: { title: "Public Domain Film", licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/", rights: "CC0" },
    d1: "ia800123.us.archive.org", dir: "/12/items/sample_film_1930",
    files: [
      { name: "film.mp4", size: "1024", format: "MPEG4" },
      { name: "poster.jpg", size: "500", format: "JPEG" },
      { name: "private.mp4", size: "100", private: "true" }
    ]
  };
  const source = createInternetArchiveSource({ fetchImpl: async () => response(metadata) });
  const item = await source.getItem("sample_film_1930");
  assert.equal(item.rightsApproved, true);
  assert.equal(item.files.length, 1);
  assert.equal(item.files[0].url, "https://ia800123.us.archive.org/12/items/sample_film_1930/film.mp4");
});

test("items without an approved rights declaration never expose download files", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async () => response({
    metadata: { title: "Unclear Film", rights: "Rights unknown" },
    d1: "ia800123.us.archive.org", dir: "/12/items/unclear_film_1930",
    files: [{ name: "film.mp4", size: "1024" }]
  })});
  const item = await source.getItem("unclear_film_1930");
  assert.equal(item.rightsApproved, false);
  assert.deepEqual(item.files, []);
});

test("rejects misleading license URLs and unsafe or private file names", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async () => response({
    metadata: { title: "Bad Rights", licenseurl: "https://evil.example/creativecommons.org/licenses/by/4.0/" },
    d1: "ia800123.us.archive.org", dir: "/12/items/bad_rights_film",
    files: [
      { name: "private.mp4", size: "100", private: true },
      { name: "../escape.mp4", size: "100" },
      { name: "ok.mp4", size: "100" }
    ]
  })});
  const item = await source.getItem("bad_rights_film");
  assert.equal(item.rightsApproved, false);
  assert.deepEqual(item.files, []);
});

test("resolves only the selected approved file to an archive subdomain", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async () => response({
    metadata: { title: "Film", licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
    d1: "ia800123.us.archive.org", dir: "/12/items/film_1935",
    files: [{ name: "film.m4v", size: "2000" }]
  })});
  const result = await source.resolve({ media: { source_id: "film_1935", source_file: "film.m4v" } });
  assert.equal(result.url, "https://ia800123.us.archive.org/12/items/film_1935/film.m4v");
  assert.equal(result.mimeType, "video/mp4");
});

test("mismatched item paths never expose files", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async () => response({
    metadata: { title: "Film", licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" },
    d1: "ia800123.us.archive.org", dir: "/12/items/another_item",
    files: [{ name: "film.mp4", size: "100" }]
  })});
  const item = await source.getItem("film_1935");
  assert.equal(item.rightsApproved, true);
  assert.deepEqual(item.files, []);
});

test("rejects malformed identifiers and redirected catalogue responses", async () => {
  const source = createInternetArchiveSource({ fetchImpl: async () => ({ ok: true, redirected: true, async json() { return {}; } }) });
  await assert.rejects(source.getItem("../bad"), /Invalid Internet Archive/);
  await assert.rejects(source.search("sample"), /could not provide/);
});
