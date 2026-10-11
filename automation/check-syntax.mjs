import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Keep this gate focused on the playback/security files touched by this change and
// their direct browser-module dependencies. Unrelated legacy files are not rewritten
// as part of this scoped hardening pass.
const files = [
  "service-worker.js",
  "scripts/mediaforge.js",
  "scripts/watch.js",
  "scripts/playback-urls.js",
  "scripts/tflix-secondary-player.js",
  "scripts/config.js",
  "scripts/routes.js",
  "scripts/utils.js",
  "scripts/library.js",
  "scripts/recommendations.js",
  "scripts/intelligence.js",
  "scripts/player-engine.js",
  "scripts/playback-servers.js",
  "scripts/server-settings.js",
  "scripts/tmdb.js"
];

let failures = 0;
for (const relativePath of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    failures += 1;
    process.stderr.write("\nSyntax check failed: " + relativePath + "\n");
    process.stderr.write(result.stderr || result.stdout || "node --check failed\n");
  }
}
if (failures) {
  process.stderr.write("\n" + failures + " of " + files.length + " scoped JavaScript files failed syntax checks.\n");
  process.exitCode = 1;
} else {
  process.stdout.write("Syntax checked " + files.length + " playback/security JavaScript files.\n");
}
