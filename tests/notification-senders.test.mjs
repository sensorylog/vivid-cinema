import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reminderSource = await readFile(new URL("../automation/send-cinema-reminders.mjs", import.meta.url), "utf8");

test("cinema reminder sender uses modular Firebase Admin APIs", () => {
  assert.match(reminderSource, /import \{\s*cert,\s*initializeApp\s*\} from "firebase-admin\/app"/);
  assert.match(reminderSource, /import \{\s*FieldValue,\s*getFirestore\s*\} from "firebase-admin\/firestore"/);
  assert.match(reminderSource, /initializeApp\(\{\s*credential:\s*cert\(serviceAccount\)\s*\}\)/);
  assert.match(reminderSource, /const db\s*=\s*getFirestore\(\)/);
  assert.match(reminderSource, /sentAt:\s*FieldValue\.serverTimestamp\(\)/);
  assert.doesNotMatch(reminderSource, /admin\.credential\.cert|admin\.firestore\(/);
});

test("cinema reminder sender handles an absent service-account secret with a clear validation error", () => {
  assert.match(reminderSource, /JSON\.parse\(process\.env\.FIREBASE_SERVICE_ACCOUNT_JSON\s*\|\|\s*"\{\}"\)/);
  const validation = reminderSource.indexOf('if(!serviceAccount.project_id)throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON")');
  const initialize = reminderSource.indexOf("initializeApp({credential:cert(serviceAccount)})");
  assert.ok(validation >= 0);
  assert.ok(initialize > validation);
});
