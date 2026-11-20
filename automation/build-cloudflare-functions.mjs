import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudflareRoot = path.join(root, "cloudflare");
const functionsRoot = path.join(cloudflareRoot, "functions");
const output = path.join(root, "dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
  }
}

run("npm", ["install", "--prefix", cloudflareRoot, "--no-audit", "--no-fund"]);
const wrangler = path.join(
  cloudflareRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler"
);
run(wrangler, [
  "pages", "functions", "build", functionsRoot,
  "--outdir", path.join(output, "_worker.js"),
  "--build-output-directory", output,
  "--project-directory", root,
  "--compatibility-date", "2026-11-20",
  "--compatibility-flags", "nodejs_compat"
]);
await access(path.join(output, "_worker.js"));
console.log("Bundled Cloudflare Pages Functions into dist/_worker.js/index.js.");
