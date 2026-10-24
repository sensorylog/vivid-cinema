import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");

test("Make Vivid Yours is recorded once locally and synced to the signed-in account", async () => {
  const intelligence = await read("scripts/intelligence.js");
  const home = await read("script.js");
  assert.match(intelligence, /ONBOARDING_SEEN_KEY="vivid:onboarding:shown:v1"/);
  assert.match(intelligence, /export function markColdStartShown\(\)/);
  assert.match(intelligence, /markColdStartShown\(\)\{const s=read\(\);try\{localStorage\.setItem\(ONBOARDING_SEEN_KEY,"1"\)\}catch\{\}if\(s\.onboarding\.shownAt\)return s/);
  assert.match(intelligence, /!s\.onboarding\.shownAt&&!s\.onboarding\.completed&&!s\.onboarding\.dismissed/);
  assert.match(intelligence, /remoteOnboarding\?\.shownAt\|\|remoteOnboarding\?\.completed\|\|remoteOnboarding\?\.dismissed/);
  assert.match(intelligence, /cloud\(\["taste","profile"\],\{onboarding:s\.onboarding\}\)/);
  assert.match(home, /markColdStartShown\(\);/);
  assert.match(home, /await startIntelligenceSync\(\)/);
  assert.doesNotMatch(home, /Promise\.race\(\[\s*startIntelligenceSync\(\)/);
});

test("Firebase auth explicitly prefers durable persistence and waits for restored sessions", async () => {
  const firebase = await read("scripts/firebase.js");
  const navAuth = await read("scripts/nav-auth.js");
  const shell = await read("scripts/app-shell.js");
  assert.match(firebase, /initializeAuth\(app,\s*\{/);
  assert.match(firebase, /persistence:\s*\[browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence\]/);
  assert.match(firebase, /popupRedirectResolver:\s*browserPopupRedirectResolver/);
  assert.match(navAuth, /await auth\.authStateReady\(\)/);
  assert.match(shell, /await auth\.authStateReady\(\)/);
});

test("Electron binds the app window to the stable default persistent session", async () => {
  const main = await read("desktop/main.cjs");
  assert.match(main, /webPreferences:\s*\{ session: session\.defaultSession/);
  assert.match(main, /LOCAL_SERVER_PORT = 43821/);
  assert.match(main, /for \(let offset = 0; offset < 5; offset \+= 1\)/);
  assert.match(main, /candidate\.listen\(port, "localhost", resolve\)/);
  assert.doesNotMatch(main, /clearStorageData\(/);
});
