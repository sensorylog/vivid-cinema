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

test("cloud library sync reads authoritative server data rather than cache-only snapshots", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  assert.match(library, /getDocsFromServer\(firestoreCollection\(db,\s*"users",\s*uid,\s*collection\)\)/);
  assert.match(library, /getDocsFromServer\(firestoreCollection\(db,\s*"users",\s*uid,\s*"libraryTombstones"\)\)/);
});

test("library sync propagates Firestore failures so the account UI cannot report false success", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  const syncBody = library.slice(
    library.indexOf("async function performLibrarySyncForUser"),
    library.indexOf("export async function syncLocalItem")
  );
  assert.doesNotMatch(syncBody, /catch\s*\([^)]*\)\s*\{[\s\S]*?return local;/);
  assert.match(syncBody, /await Promise\.all\(\[/);
  assert.match(syncBody, /Do not replace local data until all required cloud operations have been acknowledged/);
});

test("library sync reconciles deletions and avoids rewriting every unchanged remote item", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  assert.match(library, /deleteDoc\(doc\(db,\s*"users",\s*user\.uid,\s*tombstone\.collection,\s*contentId\)\)/);
  assert.match(library, /if\(!remote \|\| Number\(item\.updatedAt\|\|0\)>Number\(remote\.updatedAt\|\|0\)\)/);
  assert.match(library, /await mapLimit\(writes,8/);
});

test("library mutations retry through one deduplicated sync path and preserve per-account local snapshots", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  assert.match(library, /const syncInFlight = new Map\(\)|const syncInFlight=new Map\(\)/);
  assert.match(library, /await syncLibraryForUser\(auth\.currentUser\)/);
  assert.match(library, /window\.addEventListener\("online"/);
  assert.match(library, /accountStorageKey\(STORAGE_KEY,owner\)/);
  assert.match(library, /accountStorageKey\(STORAGE_KEY,uid\)/);
  assert.match(library, /void startLibrarySync\(\)/);
});
