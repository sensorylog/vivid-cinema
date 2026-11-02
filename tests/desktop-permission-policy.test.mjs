import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isPermissionAllowed } = require("../desktop/permission-policy.cjs");

const hostedOrigin = "https://vivid-cinema.pages.dev";
const localOrigin = "http://localhost:43821";

test("allows supported permissions from the trusted hosted app origin", () => {
  for (const permission of ["fullscreen", "media", "notifications"]) {
    assert.equal(isPermissionAllowed({
      permission,
      requestingUrl: hostedOrigin + "/home.html",
      currentUrl: hostedOrigin + "/home.html",
      allowedOrigins: [hostedOrigin, localOrigin]
    }), true, permission);
  }
});

test("allows supported permissions from the trusted local desktop origin", () => {
  assert.equal(isPermissionAllowed({
    permission: "fullscreen",
    requestingUrl: localOrigin + "/my-downloads.html",
    currentUrl: localOrigin + "/my-downloads.html",
    allowedOrigins: [hostedOrigin, localOrigin]
  }), true);
});

test("denies permissions from an untrusted origin", () => {
  assert.equal(isPermissionAllowed({
    permission: "notifications",
    requestingUrl: "https://attacker.example/request",
    currentUrl: hostedOrigin + "/home.html",
    allowedOrigins: [hostedOrigin, localOrigin]
  }), false);
});

test("denies a trusted request origin when the active webContents is elsewhere", () => {
  assert.equal(isPermissionAllowed({
    permission: "media",
    requestingUrl: hostedOrigin + "/request",
    currentUrl: "https://accounts.google.com/",
    allowedOrigins: [hostedOrigin, localOrigin]
  }), false);
});

test("denies unsupported permission types even on a trusted origin", () => {
  assert.equal(isPermissionAllowed({
    permission: "geolocation",
    requestingUrl: hostedOrigin,
    currentUrl: hostedOrigin,
    allowedOrigins: [hostedOrigin]
  }), false);
});

test("denies malformed, opaque and credential-bearing origins", () => {
  for (const requestingUrl of ["not a URL", "data:text/html,hello", "https://user:pass@vivid-cinema.pages.dev/"]) {
    assert.equal(isPermissionAllowed({
      permission: "fullscreen",
      requestingUrl,
      currentUrl: hostedOrigin,
      allowedOrigins: [hostedOrigin]
    }), false, requestingUrl);
  }
});

test("does not trust lookalike hostnames or subdomains", () => {
  for (const requestingUrl of [
    "https://vivid-cinema.pages.dev.attacker.example/",
    "https://sub.vivid-cinema.pages.dev/"
  ]) {
    assert.equal(isPermissionAllowed({
      permission: "notifications",
      requestingUrl,
      currentUrl: requestingUrl,
      allowedOrigins: [hostedOrigin]
    }), false, requestingUrl);
  }
});

test("denies permission checks without a requesting origin", () => {
  assert.equal(isPermissionAllowed({
    permission: "fullscreen",
    currentUrl: hostedOrigin,
    allowedOrigins: [hostedOrigin]
  }), false);
});

test("Electron wires both permission request and permission check handlers through the origin policy", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  assert.match(main, /setPermissionRequestHandler\(\(webContents, permission, callback, details = \{\}\)/);
  assert.match(main, /details\.requestingUrl/);
  assert.match(main, /setPermissionCheckHandler\(\(webContents, permission, requestingOrigin\)/);
  assert.match(main, /currentUrl: webContents\.getURL\(\)/);
  assert.match(main, /allowedOrigins: allowedPermissionOrigins\(\)/);
});
