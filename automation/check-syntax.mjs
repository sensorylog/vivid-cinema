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
  "desktop/local-media.cjs",
  "desktop/media-protocol.cjs",
  "desktop/preload.cjs",
  "desktop/download-engine.cjs",
  "scripts/my-downloads.js",
  "scripts/downloads/desktop-offline.js",
  "api/watch-rooms.js",
  "cloudflare/functions/api/watch-rooms.js",
  "cloudflare/functions/api/ai.js",
  "automation/build-cloudflare-functions.mjs",
  "scripts/watch-room-api.js",
  "scripts/watch-rooms.js",
  "scripts/watch-room-lobby.js",
  "scripts/watch-room-clubs.js",
  "scripts/watch-room-playback.js",
  "scripts/watch-room-player-layout.js",
  "scripts/watch.js",
  "scripts/playback/playback-urls.js",
  "scripts/playback/tflix-secondary-player.js",
  "scripts/african-stories/providers.js",
  "scripts/african-stories/policy.js",
  "scripts/african-stories/provider-session.js",
  "scripts/african-stories/media-player.js",
  "scripts/african-stories/player.js",
  "scripts/african-stories/discovery-data.js",
  "scripts/african-stories/discovery.js",
  "scripts/african-stories/acquisition.js",
  "scripts/african-stories/metrics.js",
  "cloudflare/functions/api/african-stories/session.js",
  "cloudflare/functions/api/african-stories/submissions.js",
  "cloudflare/functions/api/african-stories/metrics.js",
  "scripts/anime-premium.js",
  "scripts/anime-premium-discovery.js",
  "scripts/auth.js",
  "scripts/verify-email.js",
  "api/send-verification.js",
  "scripts/config.js",
  "scripts/routes.js",
  "scripts/utils.js",
  "scripts/library.js",
  "scripts/achievements.js",
  "scripts/achievements-page.js",
  "scripts/achievement-catalog.js",
  "scripts/cloudflare-ai.js",
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
