#!/usr/bin/env bash
set -euo pipefail
URL="\${1:?source URL required}"
DEST="\${2:-}"
LOCK_FILE="\${VIVID_MPV_DEPENDENCY_LOCK:-$(cd "$(dirname "$0")" && pwd)/mpv-dependencies.lock.json}"
if [[ ! -f "$LOCK_FILE" ]]; then
  echo "Missing pinned mpv dependency lock: $LOCK_FILE" >&2
  exit 2
fi
KEY=""
case "$URL" in
  *dav1d.git) KEY="dav1d" ;;
  *Little-CMS.git) KEY="lcms2" ;;
  *FFmpeg.git) KEY="ffmpeg" ;;
  *shaderc.git) KEY="shaderc" ;;
  *SPIRV-Cross.git) KEY="spirv-cross" ;;
  *nv-codec-headers.git) KEY="nv-codec-headers" ;;
  *Vulkan-Headers.git) KEY="vulkan-headers" ;;
  *Vulkan-Loader.git) KEY="vulkan-loader" ;;
  *libplacebo.git) KEY="libplacebo" ;;
  *libass.git) KEY="libass" ;;
  *LuaJIT.git) KEY="luajit" ;;
  *)
    echo "Unpinned Git dependency requested by upstream build: $URL" >&2
    exit 3
    ;;
esac
readarray -t ENTRY < <(node -e '
  const lock = require(process.argv[1]);
  const item = lock.dependencies[process.argv[2]];
  if (!item) process.exit(2);
  console.log(item.source);
  console.log(item.commit);
' "$LOCK_FILE" "$KEY")
SOURCE="\${ENTRY[0]}"
COMMIT="\${ENTRY[1]}"
if [[ ! "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid pinned commit for $KEY" >&2
  exit 4
fi
if [[ -z "$DEST" ]]; then
  DEST="\${URL##*/}"
  DEST="\${DEST%.git}"
fi
rm -rf "$DEST"
mkdir -p "$DEST"
git -C "$DEST" init -q
git -C "$DEST" remote add origin "$SOURCE"
git -C "$DEST" fetch --depth=1 origin "$COMMIT"
git -C "$DEST" checkout --detach FETCH_HEAD
git -C "$DEST" submodule update --init --recursive --depth 1
ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [[ "$ACTUAL" != "$COMMIT" ]]; then
  echo "Pinned dependency revision mismatch for $KEY" >&2
  exit 5
fi
