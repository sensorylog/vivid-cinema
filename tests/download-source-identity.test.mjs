import test from "node:test";
import assert from "node:assert/strict";
import { validateAllowedHttpsUrl } from "../scripts/playback/direct-stream-validation.js";

test("download URL validation rejects non-HTTPS, unapproved and deceptive hosts", () => {
  const host = "media.example";
  assert.equal(validateAllowedHttpsUrl("https://" + host + "/licensed-video.mp4", [host])?.hostname, host);
  assert.equal(validateAllowedHttpsUrl("https://unapproved.example/video.mp4", [host]), null);
  assert.equal(validateAllowedHttpsUrl("https://" + host + ".evil.test/video.mp4", [host]), null);
  assert.equal(validateAllowedHttpsUrl("http://" + host + "/video.mp4", [host]), null);
});
