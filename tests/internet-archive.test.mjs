import test from "node:test";
import assert from "node:assert/strict";
import { createInternetArchiveProvider } from "../scripts/downloads/internet-archive.js";

const movie = { id: "550", media_type: "movie", title: "Example Film", year: "1931" };
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function archiveFile(name = "example.mp4", size = 25 * 1024 * 1024, extra = {}) {
  return { name, size: String(size), format: "MPEG4", source: "original", ...extra };
}
function setup(fetchImpl) {
  globalThis.location = { origin: "https://vivid.example", hostname: "vivid.example" };
  return createInternetArchiveProvider({ fetchImpl });
}

test("searches Internet Archive automatically and returns only explicitly licensed video files", async () => {
  const calls = [];
  const provider = setup(async (url, init) => {
    calls.push({ url: new URL(url), init });
    if (String(url).includes("advancedsearch.php")) return jsonResponse({ response: { docs: [{ identifier: "example_film" }] } });
    return jsonResponse({ metadata: { title: "Example Film", year: "1931", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" },
      files: [archiveFile(), archiveFile("example.jpg", 10000000), archiveFile("private.mp4", 25000000, { private: "true" }), archiveFile("tiny.mp4", 2000)] });
  });
  const options = await provider.getOptions(movie);
  assert.equal(options.length, 1);
  assert.equal(options[0].sourceId, "internet-archive");
  assert.equal(options[0].format, "MP4");
  assert.equal(options[0].id, "example_film::example.mp4");
  assert.match(options[0].label, /Example Film.*MP4.*25\.0 MB/);
  assert.equal(calls[0].url.hostname, "archive.org");
  assert.equal(calls[0].url.pathname, "/advancedsearch.php");
  assert.equal(calls[0].url.searchParams.get("q"), 'mediatype:movies AND title:"Example Film"');
  assert.equal(calls[0].init.credentials, "omit");
});

test("rejects items without an explicit public-domain or Creative Commons declaration", async () => {
  const provider = setup(async url => String(url).includes("advancedsearch.php")
    ? jsonResponse({ response: { docs: [{ identifier: "unknown_rights" }] } })
    : jsonResponse({ metadata: { title: "Unknown rights" }, files: [archiveFile()] }));
  assert.deepEqual(await provider.getOptions(movie), []);
});

test("supports Creative Commons licences and safe direct-download proxy URLs", async () => {
  const provider = setup(async url => String(url).includes("advancedsearch.php")
    ? jsonResponse({ response: { docs: [{ identifier: "cc_movie" }] } })
    : jsonResponse({ metadata: { title: "CC Movie", licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
      files: [archiveFile("cc-movie.webm", 45 * 1024 * 1024)] }));
  const [option] = await provider.getOptions({ ...movie, title: "CC Movie" });
  const source = await provider.resolve({ media: { source_file: option.id } });
  const url = new URL(source.url);
  assert.equal(url.origin, "https://vivid.example");
  assert.equal(url.pathname, "/api/ia-download/cc_movie/cc-movie.webm");
  assert.deepEqual(source.allowedHosts, ["vivid.example"]);
  assert.equal(source.mimeType, "video/webm");
});

test("rejects malformed archive identifiers and unsupported filenames", async () => {
  const provider = setup(async () => jsonResponse({}));
  await assert.rejects(provider.resolve({ media: { source_file: "../escape::movie.mp4" } }), /invalid/);
  await assert.rejects(provider.resolve({ media: { source_file: "valid_item::movie.exe" } }), /supported video format/);
});

test("fails clearly when the archive search service is unavailable", async () => {
  const provider = setup(async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(provider.getOptions(movie), /HTTP 503/);
});
