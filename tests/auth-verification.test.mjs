import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [auth, handler, page, worker] = await Promise.all([
  readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-email.js", import.meta.url), "utf8"),
  readFile(new URL("../verify-email.html", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8")
]);

test("signup sends a verification continuation URL", () => {
  assert.match(auth, /sendEmailVerification\(credential\.user,\s*\{url:new URL\("verify-email\.html",window\.location\.href\)\.href,handleCodeInApp:false\}\)/);
  assert.match(auth, /After verification, Vivid will show a success screen/);
});

test("verification handler applies Firebase action code before showing success", () => {
  assert.match(handler, /params\.get\("mode"\)/);
  assert.match(handler, /params\.get\("oobCode"\)/);
  assert.match(handler, /await applyActionCode\(auth, code\)/);
  assert.match(handler, /Email verified successfully!/);
  assert.match(handler, /expired or already been used/);
});

test("verification page is precached and loads its handler", () => {
  assert.match(page, /scripts\/verify-email\.js/);
  assert.match(worker, /"\.\/verify-email\.html"/);
  assert.match(worker, /"\.\/scripts\/verify-email\.js"/);
  assert.match(worker, /vivid-cinema-shell-v159/);
});
