/**
 * Shared provider capability registry for Watch Room playback.
 *
 * URL construction intentionally remains in each existing player module.
 * A provider is not remotely controllable merely because it emits progress
 * messages. Capabilities are opt-in and default to false.
 */

const NO_CAPABILITIES = Object.freeze({
  canPlay: false,
  canPause: false,
  canSeek: false,
  canReadPosition: false,
  canReadStatus: false,
  canReportEnded: false
});

function provider(playerId, providerId, label, origin, capabilities = NO_CAPABILITIES) {
  return Object.freeze({
    playerId,
    providerId,
    label,
    origin,
    capabilities: Object.freeze({ ...NO_CAPABILITIES, ...capabilities })
  });
}

const VID_SRC_CAPABILITIES = Object.freeze({
  canPlay: true,
  canPause: true,
  canSeek: true,
  canReadPosition: true,
  canReadStatus: true,
  canReportEnded: true
});

const CINESRC_CAPABILITIES = Object.freeze({
  canPlay: true,
  canPause: true,
  canSeek: true,
  canReadPosition: true,
  canReadStatus: true,
  canReportEnded: true
});

// Player 1 provider IDs match scripts/watch.js source IDs.
const PLAYER_1 = [
  provider("player1", "vidapi", "VidAPI", "https://vaplayer.ru"),
  provider("player1", "vidsrc", "VidSrc", "https://vidsrc.sh", VID_SRC_CAPABILITIES),
  provider("player1", "vidlink", "VidLink", "https://vidlink.pro"),
  provider("player1", "vidplus", "VidPlus", "https://player.vidplus.to"),
  provider("player1", "vidking", "VidKing", "https://www.vidking.net"),
  provider("player1", "embedwave", "EmbedWave", "https://embedwave.cc"),
  provider("player1", "vidfast", "VidFast", "https://vidfast.to"),
  provider("player1", "ezvidapi", "EZVidAPI", "https://ezvidapi.com"),
  provider("player1", "embedapistream", "EmbedAPIStream", "https://watch.embed-api.stream"),
  provider("player1", "moviesapi", "MoviesAPI", "https://moviesapi.to")
];

// Player 2 IDs match buildTflixSecondaryServerUrl() in
// scripts/playback/tflix-secondary-player.js. CineSRC is enabled because its
// documented command and event protocol is implemented below.
const PLAYER_2 = [
  provider("player2", "moviesapi", "MoviesAPI", "https://moviesapi.to"),
  provider("player2", "vidsrc-embed", "VidSrc Embed", "https://vidsrc-embed.ru"),
  provider("player2", "cinesrc", "CineSRC", "https://cinesrc.st", CINESRC_CAPABILITIES),
  provider("player2", "vidfast", "VidFast", "https://vidfast.vc"),
  provider("player2", "vidlink", "VidLink", "https://vidlink.pro")
];

const ADAPTERS = new Map([...PLAYER_1, ...PLAYER_2].map(item => [
  item.playerId + ":" + item.providerId,
  item
]));

export function getProviderAdapter(playerId, providerId) {
  if (typeof playerId !== "string" || typeof providerId !== "string") return null;
  return ADAPTERS.get(playerId + ":" + providerId) || null;
}

export function listProviderAdapters(playerId) {
  return [...ADAPTERS.values()]
    .filter(item => !playerId || item.playerId === playerId)
    .map(item => ({ ...item, capabilities: { ...item.capabilities } }));
}

export function providerSupports(playerId, providerId, capability) {
  const adapter = getProviderAdapter(playerId, providerId);
  return Boolean(adapter && Object.hasOwn(adapter.capabilities, capability) && adapter.capabilities[capability] === true);
}

export function sendProviderCommand({ adapter, frame, action, position } = {}) {
  if (!adapter || !frame?.contentWindow || !frame.src) return false;
  const commandCapability = action === "play" ? "canPlay"
    : action === "pause" ? "canPause"
    : action === "seek" ? "canSeek"
    : null;
  if (!commandCapability || !adapter.capabilities[commandCapability]) return false;

  let frameOrigin;
  try { frameOrigin = new URL(frame.src).origin; } catch { return false; }
  if (frameOrigin !== adapter.origin) return false;

  let message;
  if (adapter.playerId === "player2" && adapter.providerId === "cinesrc") {
    const command = action === "seek" ? "seek" : action;
    const args = action === "seek" ? [Math.max(0, Number(position) || 0)] : [];
    message = { type: "cinesrc:command", command, args };
  } else {
    message = action === "seek"
      ? { player: true, action: "seek" + Math.max(0, Math.floor(Number(position) || 0)) }
      : { player: true, action };
  }
  frame.contentWindow.postMessage(message, adapter.origin);
  return true;
}
