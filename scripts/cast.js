import { VIVID_CONFIG } from "./config.js";

const CAST_SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const CAST_NAMESPACE = "urn:x-cast:com.vividcinema.cast";
let castReady = false;
let castInitialized = false;
let castMedia = null;
let sdkPromise = null;

function isConfigured() {
  return Boolean(String(VIVID_CONFIG.api.castReceiverAppId || "").trim());
}

function loadCastSdk() {
  if (!isConfigured()) return Promise.resolve(false);
  if (window.cast?.framework) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve) => {
    const previous = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (available) => {
      if (typeof previous === "function") previous(available);
      castReady = Boolean(available && window.cast?.framework && window.chrome?.cast);
      resolve(castReady);
    };

    const script = document.createElement("script");
    script.src = CAST_SDK_URL;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function sendCurrentMedia() {
  if (!castMedia || !window.cast?.framework) return;
  const context = window.cast.framework.CastContext.getInstance();
  const session = context.getCurrentSession();
  if (!session) return;

  session.sendMessage(CAST_NAMESPACE, {
    type: "LOAD_VIVID_MEDIA",
    url: castMedia.url,
    title: castMedia.title || "Vivid Cinema",
    sentAt: Date.now()
  }).catch((error) => {
    console.warn("Vivid Cast message failed:", error);
  });
}

function initializeCast() {
  if (castInitialized || !castReady) return;
  const appId = String(VIVID_CONFIG.api.castReceiverAppId || "").trim();
  if (!appId) return;

  const context = window.cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: appId,
    autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });

  context.addEventListener(
    window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    (event) => {
      if (
        event.sessionState === window.cast.framework.SessionState.SESSION_STARTED ||
        event.sessionState === window.cast.framework.SessionState.SESSION_RESUMED
      ) {
        sendCurrentMedia();
      }
    }
  );

  castInitialized = true;
}

export function setCastMedia(media) {
  if (!media?.url) return;
  castMedia = {
    url: String(media.url),
    title: String(media.title || "Vivid Cinema")
  };
  sendCurrentMedia();
}

export async function initCast() {
  if (!isConfigured()) return false;
  const available = await loadCastSdk();
  if (!available) return false;
  initializeCast();
  return true;
}

window.addEventListener("vivid:cast-media", (event) => {
  setCastMedia(event.detail);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void initCast(); }, { once: true });
} else {
  void initCast();
}

export { CAST_NAMESPACE };
