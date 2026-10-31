import test from "node:test";
import assert from "node:assert/strict";
import { createWikimediaCommonsProvider } from "../scripts/downloads/wikimedia-commons.js";

function result({ license = "https://creativecommons.org/licenses/by/4.0/", mime = "video/mp4" } = {}) {
  return { query: { pages: [{
    pageid: 1, title: "File:Example Film.mp4",
    imageinfo: [{
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example_Film.mp4",
      size: 32 * 1024 * 1024, mime,
      extmetadata: { LicenseUrl: { value: license }, LicenseShortName: { value: "CC BY 4.0" } }
    }]
  }] } };
}
test("searches Commons automatically and only returns openly licensed video files", async () => {
  let requested;
  const provider = createWikimediaCommonsProvider({ fetchImpl: async url => {
    requested = new URL(url);
    return Response.json(result());
  } });
  const options = await provider.getOptions({ title: "Example Film", media_type: "movie" });
  assert.equal(requested.hostname, "commons.wikimedia.org");
  assert.equal(requested.searchParams.get("generator"), "search");
  assert.match(requested.searchParams.get("gsrsearch"), /filemime:video/);
  assert.equal(options.length, 1);
  assert.equal(options[0].sourceId, "wikimedia-commons");
  assert.equal(options[0].id, "File:Example Film.mp4");
  assert.match(options[0].label, /MP4.*32\.0 MB/);
});
test("filters out files with missing or non-open licence metadata", async () => {
  const provider = createWikimediaCommonsProvider({ fetchImpl: async () => Response.json(result({ license: "https://example.com/all-rights-reserved" })) });
  assert.deepEqual(await provider.getOptions({ title: "Example Film" }), []);
});
test("resolves Commons items through the same-origin Vivid streaming proxy", async () => {
  globalThis.location = { origin: "https://vivid.example" };
  const provider = createWikimediaCommonsProvider({ fetchImpl: async () => Response.json(result()) });
  const source = await provider.resolve({ media: { source_file: "File:Example Film.mp4" } });
  const url = new URL(source.url);
  assert.equal(url.origin, "https://us-central1-vivid-cinema.cloudfunctions.net");
  assert.equal(url.pathname, "/downloadMedia");
  assert.equal(url.searchParams.get("source"), "wikimedia-commons");
  assert.equal(url.searchParams.get("title"), "File:Example Film.mp4");
  assert.deepEqual(source.allowedHosts, ["us-central1-vivid-cinema.cloudfunctions.net"]);
});
test("rejects invalid Commons file titles", async () => {
  const provider = createWikimediaCommonsProvider({ fetchImpl: async () => Response.json({}) });
  await assert.rejects(provider.resolve({ media: { source_file: "../not-a-file" } }), /invalid/);
});
