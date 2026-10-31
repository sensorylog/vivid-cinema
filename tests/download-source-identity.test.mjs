import test from "node:test";
import assert from "node:assert/strict";
import { validateAllowedHttpsUrl } from "../scripts/playback/direct-stream-validation.js";

test("download sources can reach only Vivid's managed HTTPS media function", () => {
  const host = "us-central1-vivid-cinema.cloudfunctions.net";
  assert.equal(validateAllowedHttpsUrl("https://" + host + "/downloadMedia?source=internet-archive", [host])?.hostname, host);
  assert.equal(validateAllowedHttpsUrl("https://ia800123.us.archive.org/12/items/a/file.mp4", [host]), null);
  assert.equal(validateAllowedHttpsUrl("https://" + host + ".evil.test/downloadMedia", [host]), null);
  assert.equal(validateAllowedHttpsUrl("http://" + host + "/downloadMedia", [host]), null);
});
