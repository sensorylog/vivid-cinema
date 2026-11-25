const HLS_LIBRARY = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
const DASH_LIBRARY = "https://cdn.dashjs.org/v5.0.3/dash.all.min.js";
let activeHls = null;
let activeDash = null;

function loadLibrary(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-african-library="' + globalName + '"]');
    const script = existing || document.createElement("script");
    const finish = () => globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error("The playback library could not be loaded."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("The playback library could not be loaded.")), { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      script.dataset.africanLibrary = globalName;
      document.head.append(script);
    }
  });
}

function clearAdapters() {
  if (activeHls) { try { activeHls.destroy(); } catch {} activeHls = null; }
  if (activeDash) { try { activeDash.reset(); } catch {} activeDash = null; }
}

function waitForVideo(video, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve(true);
    };
    const onReady = () => finish(null);
    const onError = () => finish(new Error("The authorized media source could not be loaded."));
    const timer = setTimeout(() => finish(new Error("The authorized media source timed out.")), timeoutMs);
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function playAuthorizedMedia(video, session) {
  const url = new URL(session.url);
  if (url.protocol !== "https:") throw new TypeError("Only HTTPS playback sessions are accepted.");
  clearAdapters();
  video.pause();
  video.removeAttribute("src");
  video.load();

  let Hls = null;
  let dashjs = null;
  if (session.mimeType === "application/vnd.apple.mpegurl" &&
      !video.canPlayType("application/vnd.apple.mpegurl")) {
    Hls = await loadLibrary(HLS_LIBRARY, "Hls");
    if (!Hls.isSupported()) throw new Error("This device cannot play the authorized HLS stream.");
  }
  if (session.mimeType === "application/dash+xml") {
    dashjs = await loadLibrary(DASH_LIBRARY, "dashjs");
  }

  const ready = waitForVideo(video);
  if (session.mimeType === "application/vnd.apple.mpegurl") {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url.toString();
      video.load();
    } else {
      activeHls = new Hls({ enableWorker: true, lowLatencyMode: false });
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MEDIA_ATTACHED, () => activeHls?.loadSource(url.toString()));
      activeHls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          clearAdapters();
          video.dispatchEvent(new Event("error"));
        }
      });
    }
  } else if (session.mimeType === "application/dash+xml") {
    activeDash = dashjs.MediaPlayer().create();
    activeDash.initialize(video, url.toString(), false);
    activeDash.on(dashjs.MediaPlayer.events.ERROR, () => video.dispatchEvent(new Event("error")));
  } else if (["video/mp4", "video/webm"].includes(session.mimeType)) {
    video.src = url.toString();
    video.load();
  } else {
    throw new TypeError("Unsupported authorized playback format.");
  }
  await ready;
  return true;
}
export function stopAuthorizedMedia(video) {
  clearAdapters();
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}
