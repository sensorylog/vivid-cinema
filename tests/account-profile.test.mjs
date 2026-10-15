import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../scripts/account.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../account.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/vivid-account.css", import.meta.url), "utf8");

test("profile avatar safely uses provider photo URLs with an initials fallback", () => {
  assert.match(script, /user\.photoURL\s*\|\|\s*user\.providerData/);
  assert.match(script, /url\.protocol\s*===\s*"https:"/);
  assert.match(script, /avatarEl\.textContent\s*=.*toUpperCase\(\)/);
  assert.match(script, /image\.alt\s*=\s*""/);
});

test("profile form tracks unsaved edits and supports discarding them", () => {
  assert.match(script, /function valuesChanged\(\)/);
  assert.match(script, /function cancelEdits\(\)/);
  assert.match(page, /id="cancel-btn"/);
  assert.match(script, /control\?\.addEventListener\("input", refreshSaveState\)/);
});

test("local preference reads and writes are resilient to unavailable browser storage", () => {
  assert.match(script, /function loadLocalPreferences\(\)[\s\S]*?const read = \(key\) => \{\s*try\s*\{ return localStorage\.getItem/);
  assert.match(script, /function saveLocalPreferences\(preferences\)[\s\S]*?try \{ localStorage\.setItem/);
});

test("account sync does not claim cloud sync succeeded until manual sync resolves", () => {
  assert.match(script, /Library on this device/);
  assert.match(script, /const library = await syncLibraryForUser\(user\)/);
  assert.match(script, /Synced just now/);
});

test("Google-only accounts are not offered a misleading email password reset", () => {
  assert.match(script, /some\(\(item\) => item\.providerId === "password"\)/);
  assert.match(script, /Managed by Google/);
});

test("profile controls retain visible keyboard focus and reduced-motion support", () => {
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(page, /aria-live="polite"/);
});
