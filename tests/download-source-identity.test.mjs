import test from "node:test";
import assert from "node:assert/strict";
import { validateAllowedHttpsUrl } from "../scripts/playback/direct-stream-validation.js";

test("same-origin Vivid download proxy is the only browser-facing source host", () => {
  assert.equal(validateAllowedHttpsUrl("https://vivid-cinema.pages.dev/api/ia-download/movie_id/file.mp4", ["vivid-cinema.pages.dev"])?.hostname, "vivid-cinema.pages.dev");
  assert.equal(validateAllowedHttpsUrl("https://ia800123.us.archive.org/12/items/a/file.mp4", ["vivid-cinema.pages.dev"]), null);
  assert.equal(validateAllowedHttpsUrl("https://vivid-cinema.pages.dev.evil.test/file.mp4", ["vivid-cinema.pages.dev"]), null);
  assert.equal(validateAllowedHttpsUrl("http://vivid-cinema.pages.dev/api/ia-download/a/b.mp4", ["vivid-cinema.pages.dev"]), null);
});
