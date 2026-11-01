#!/usr/bin/env bash
set -euo pipefail
readonly MPV_COMMIT="41f6a645068483470267271e1d09966ca3b9f413"
readonly MPV_URL="https://github.com/mpv-player/mpv.git"
readonly WORK_ROOT="\${RUNNER_TEMP:-/tmp}/vivid-mpv-source-build"
readonly MPV_ROOT="$WORK_ROOT/mpv"
readonly REPO_ROOT="\${GITHUB_WORKSPACE:-$(pwd)}"
rm -rf "$WORK_ROOT"
mkdir -p "$WORK_ROOT"
git clone --no-checkout "$MPV_URL" "$MPV_ROOT"
git -C "$MPV_ROOT" checkout --detach "$MPV_COMMIT"
test "$(git -C "$MPV_ROOT" rev-parse HEAD)" = "$MPV_COMMIT"
cd "$MPV_ROOT"
export TARGET="x86_64-w64-mingw32"
export RUST_TARGET="x86_64-pc-windows-gnu"
export WINEDEBUG="-all"
rustup target add "$RUST_TARGET"
./ci/build-mingw64.sh meson pack
meson test -C mingw_build --print-errorlogs
wine ./artifact/mpv.com -v --no-config
test -s artifact/mpv.exe
mkdir -p "$REPO_ROOT/desktop/vendor/mpv"
find "$REPO_ROOT/desktop/vendor/mpv" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a artifact/. "$REPO_ROOT/desktop/vendor/mpv/"
test -s "$REPO_ROOT/desktop/vendor/mpv/mpv.exe"
mkdir -p "$REPO_ROOT/licenses/mpv"
rm -f "$REPO_ROOT/licenses/mpv/CORRESPONDING-SOURCE.zip"
zip -q -r "$REPO_ROOT/licenses/mpv/CORRESPONDING-SOURCE.zip" . \
  -x "*/.git/*" ".git/*" "mingw_build/*" "mingw_prefix/*" "artifact/*" \
     "*/builddir/*" "*/.cache/*" "*.o" "*.a" "*.dll" "*.exe" "*.com"
node "$REPO_ROOT/desktop/create-mpv-source-manifest.cjs" \
  --source-root "$MPV_ROOT" \
  --archive "$REPO_ROOT/licenses/mpv/CORRESPONDING-SOURCE.zip" \
  --project-root "$REPO_ROOT"
node "$REPO_ROOT/desktop/verify-mpv-source-candidate.cjs" --project-root "$REPO_ROOT"
node - "$REPO_ROOT/desktop/vendor/mpv" "$MPV_COMMIT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [runtimeDir, sourceCommit] = process.argv.slice(2);
const files = fs.readdirSync(runtimeDir).filter(name => fs.statSync(path.join(runtimeDir, name)).isFile());
const runtime = {
  version: "0.41.0",
  sourceCommit,
  buildMethod: "mpv upstream ci/build-mingw64.sh at the pinned stable source commit",
  architecture: "x86_64-w64-mingw32",
  files: Object.fromEntries(files.map(name => [
    name,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(runtimeDir, name))).digest("hex")
  ]))
};
fs.writeFileSync(path.join(runtimeDir, "vivid-mpv-runtime.json"), JSON.stringify(runtime, null, 2) + "\n");
NODE
echo "Built and source-snapshotted mpv candidate. It has not replaced Vivid's production runtime."
