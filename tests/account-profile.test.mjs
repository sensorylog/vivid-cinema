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
  assert.match(syncBody, /Do not replace local data until all required cloud operations have been[\s\S]*?acknowledged/);
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
  assert.match(library, /switchLocalOwner\(/);
  assert.match(library, /ownerKey:LOCAL_OWNER_KEY/);
  assert.match(library, /activeKeys:\[STORAGE_KEY,TOMBSTONE_STORAGE_KEY\]/);
  assert.match(library, /void startLibrarySync\(\)/);
});

test("sync repeats when a library mutation arrives mid-sync and aborts safely on account changes", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  assert.match(library, /do\{\s*syncedRevision=localMutationRevision;\s*result=await performLibrarySyncForUser\(user\);\s*\}while\(syncedRevision!==localMutationRevision\)/);
  assert.match(library, /The signed-in account changed during library sync/);
  assert.match(library, /const activeAuth=await getFirebaseAuth\(\)/);
});


test("shared navigation resolves the account destination from Firebase auth state", async () => {
  const shell = readFileSync(new URL("../scripts/app-shell.js", import.meta.url), "utf8");
  assert.match(shell, /account\.href = "account\.html"/);
  assert.match(shell, /function syncAccountNavigation\(\)/);
  assert.match(shell, /onAuthStateChanged\(auth, \(user\) => \{/);
  assert.match(shell, /const destination = user \? "account\.html" : "auth\.html"/);
  assert.match(shell, /syncAccountNavigation\(\)/);
});

test("Google profile sync preserves the original membership date", () => {
  const auth = readFileSync(new URL("../scripts/auth.js", import.meta.url), "utf8");
  assert.match(auth, /import \{ doc, getDoc, serverTimestamp, setDoc \}/);
  assert.match(auth, /if\(!snapshot\.exists\(\)\|\|!snapshot\.data\(\)\?\.createdAt\)profile\.createdAt=serverTimestamp\(\)/);
  assert.match(auth, /provider:\(user\.providerData\|\|\[\]\)\.some\(item=>item\.providerId==="google\.com"\)\?"google\.com":"password"/);
});

test("account renders signed-in identity before cloud profile fetch completes", () => {
  assert.match(script, /function renderSignedInIdentity\(user\)/);
  assert.match(script, /renderSignedInIdentity\(user\);\s*setStatus\("Loading your account details/);
  assert.match(script, /6500/);
  assert.match(script, /Your cloud profile took too long to respond/);
});

test("account logout gives immediate feedback and handles a stalled sign-out", () => {
  assert.match(script, /logoutButton\.textContent = "Signing out…"/);
  assert.match(script, /withTimeout\(signOut\(auth\), 10000/);
  assert.match(script, /Could not log out\. Check your connection and try again\./);
});

test("account page and account runtime are network-first for installed PWA freshness", () => {
  const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(page, /scripts\/account\.js\?v=20261016-account-runtime-2/);
  assert.match(worker, /vivid-cinema-shell-v201/);
  assert.match(worker, /auth-diagnostics\|account\)\\\.html/);
  assert.match(worker, /auth-diagnostics\|app-shell\|account\|account-bootstrap\)\\\.js/);
});


test("library server reads have a finite timeout so sync cannot spin forever", () => {
  const library = readFileSync(new URL("../scripts/library.js", import.meta.url), "utf8");
  assert.match(library, /async function withLibraryTimeout/);
  assert.match(library, /Cloud library read timed out for/);
  assert.match(library, /Cloud library deletion sync timed out/);
});

test("account page includes a visible bootstrap diagnostic and account deletion action", () => {
  assert.match(page, /account-bootstrap\.js\?v=20261016-account-bootstrap-1/);
  assert.match(page, /id="delete-account-btn"/);
  assert.match(script, /async function permanentlyDeleteAccount\(\)/);
  assert.match(script, /reauthenticateWithCredential/);
  assert.match(script, /reauthenticateWithPopup/);
  assert.match(script, /deleteUser\(user\)/);
  assert.match(script, /ACCOUNT_PRIVATE_COLLECTIONS/);
});

test("release-state records can be deleted by their owner but not created or updated by clients", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/releaseStates\/{stateId} \{[\s\S]*?allow get, list: if isOwner\(userId\);[\s\S]*?allow delete: if isOwner\(userId\);[\s\S]*?allow create, update: if false;/);
});


test("first account visit creates a missing Firestore profile instead of silently treating it as synced", () => {
  assert.match(script, /if \(!snapshot\.exists\(\)\)/);
  assert.match(script, /setDoc\(doc\(db, "users", user\.uid\), profile, \{ merge: true \}\)/);
  assert.match(script, /Your cloud profile could not be created/);
});
