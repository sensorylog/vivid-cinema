import test from "node:test";
import assert from "node:assert/strict";
import { validateAllowedHttpsUrl } from "../scripts/playback/direct-stream-validation.js";

test("wildcard allowlists accept genuine Internet Archive subdomains only", () => {
  assert.equal(validateAllowedHttpsUrl("https://ia800123.us.archive.org/12/items/a/file.mp4", ["*.archive.org"])?.hostname, "ia800123.us.archive.org");
  assert.equal(validateAllowedHttpsUrl("https://archive.org/download/a/file.mp4", ["*.archive.org"]), null);
  assert.equal(validateAllowedHttpsUrl("https://archive.org.evil.test/file.mp4", ["*.archive.org"]), null);
  assert.equal(validateAllowedHttpsUrl("http://ia800123.us.archive.org/file.mp4", ["*.archive.org"]), null);
});
