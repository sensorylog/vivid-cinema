import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../automation/send-release-alerts.mjs", import.meta.url), "utf8");

test("release alert sender uses the modular Firebase Admin SDK", () => {
  assert.match(source, /import \{\s*cert,\s*initializeApp\s*\} from "firebase-admin\/app"/);
  assert.match(source, /import \{\s*getFirestore\s*\} from "firebase-admin\/firestore"/);
  assert.match(source, /initializeApp\(\{\s*credential:\s*cert\(serviceAccount\)\s*\}\)/);
  assert.match(source, /const db\s*=\s*getFirestore\(\)/);
  assert.doesNotMatch(source, /admin\.credential\.cert|admin\.firestore\(\)/);
});

test("release alert sender validates required secrets before connecting to Firebase", () => {
  const serviceAccountCheck = source.indexOf('if(!serviceAccount.project_id)throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON")');
  const vapidCheck = source.indexOf('if(!vapidPrivateKey)throw new Error("Missing VAPID_PRIVATE_KEY")');
  const initialize = source.indexOf("initializeApp({credential:cert(serviceAccount)})");
  assert.ok(serviceAccountCheck >= 0);
  assert.ok(vapidCheck > serviceAccountCheck);
  assert.ok(initialize > vapidCheck);
});
