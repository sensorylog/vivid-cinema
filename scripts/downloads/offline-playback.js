const LOCAL_ASSET_URI = /^opfs:\/\/vivid-cinema-downloads\/[a-zA-Z0-9_-]{1,128}$/;

export function createOfflinePlaybackController({ adapter, video } = {}) {
  if (typeof adapter?.getAssetUrl !== "function") {
    throw new TypeError("An offline asset adapter is required.");
  }
  if (!video || typeof video.load !== "function" || typeof video.pause !== "function") {
    throw new TypeError("A video element is required.");
  }

  let activeUrl = null;
  let generation = 0;

  async function stop() {
    generation += 1;
    try { video.pause(); } catch {}
    video.removeAttribute?.("src");
    try { video.load(); } catch {}
    const previousUrl = activeUrl;
    activeUrl = null;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }

  async function play(asset, { startAt = 0 } = {}) {
    if (!asset || typeof asset.uri !== "string" || !LOCAL_ASSET_URI.test(asset.uri)) {
      throw new TypeError("The selected item is not a supported local offline asset.");
    }
    const request = ++generation;
    const nextUrl = await adapter.getAssetUrl(asset);
    if (request !== generation) {
      URL.revokeObjectURL(nextUrl);
      return false;
    }
    if (typeof nextUrl !== "string" || !nextUrl.startsWith("blob:")) {
      throw new TypeError("The offline adapter did not return a local object URL.");
    }

    const previousUrl = activeUrl;
    activeUrl = nextUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);

    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = nextUrl;
    video.load();

    const resumeAt = Number(startAt);
    if (Number.isFinite(resumeAt) && resumeAt > 0) {
      const seek = () => {
        if (request !== generation) return;
        if (Number.isFinite(video.duration) && video.duration > resumeAt) {
          try { video.currentTime = resumeAt; } catch {}
        }
      };
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    return true;
  }

  return Object.freeze({ play, stop });
}
