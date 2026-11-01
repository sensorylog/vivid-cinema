import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Check runtime-critical browser modules, including the home-page trending hero,
// alongside playback/security modules and the Vivid Intelligence entry point.
const files = [
  "service-worker.js",
  "scripts/platform-origin-redirect.js",
  "desktop/main.cjs",
  "desktop/advanced-player.cjs",
  "desktop/prepare-mpv.cjs",
  "desktop/preload.cjs",
  "desktop/download-engine.cjs",
  "scripts/my-downloads.js",
  "scripts/downloads/desktop-offline.js",
  "scripts/watch.js",
  "scripts/playback/playback-urls.js",
  "scripts/playback/tflix-secondary-player.js",
  "scripts/config.js",
  "scripts/routes.js",
  "scripts/utils.js",
  "scripts/library.js",
  "scripts/achievements.js",
  "scripts/achievements-page.js",
  "scripts/achievement-catalog.js",
  "scripts/firebase-ai.js",
  "scripts/recommendations.js",
  "scripts/intent-parser.js",
  "scripts/for-you.js",
  "scripts/intelligence.js",
  "scripts/playback/player-engine.js",
  "scripts/playback/playback-servers.js",
  "scripts/playback/server-settings.js",
  "scripts/playback/direct-stream-validation.js",
  "scripts/tmdb.js",
  "scripts/tflix-hero.js",
  "script.js"
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
  process.stdout.write("Syntax checked " + files.length + " scoped JavaScript files.\n");
}
