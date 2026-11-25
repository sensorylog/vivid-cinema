import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const allowed = [
  "africanStoriesEditor",
  "africanStoriesPublisher",
  "africanStoriesRightsAdmin",
  "africanStoriesProviderAdmin"
];
const [uid, rolesArg] = process.argv.slice(2);

if (!uid || !rolesArg) {
  console.error("Usage: node scripts/admin/set-african-stories-claims.mjs <firebase-auth-uid> <role1,role2|none>");
  console.error("Allowed roles: " + allowed.join(", "));
  process.exit(2);
}

const requested = rolesArg === "none" ? [] : [...new Set(rolesArg.split(",").map(role => role.trim()).filter(Boolean))];
const invalid = requested.filter(role => !allowed.includes(role));
if (invalid.length) {
  console.error("Unsupported role(s): " + invalid.join(", "));
  process.exit(2);
}

if (!getApps().length) initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const user = await auth.getUser(uid);
const existing = user.customClaims || {};
const next = { ...existing };
for (const role of allowed) {
  if (requested.includes(role)) next[role] = true;
  else delete next[role];
}
await auth.setCustomUserClaims(uid, next);
console.log(JSON.stringify({
  uid,
  assignedAfricanStoriesRoles: requested,
  note: "Existing non-African-Stories custom claims were preserved. The user must refresh their ID token."
}, null, 2));
