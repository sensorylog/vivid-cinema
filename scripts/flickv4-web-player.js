const $ = (root, id) => root?.querySelector("#" + id);

export function getNextServer(current, available) {
  const servers = Array.isArray(available) ? available.filter(Boolean) : [];
  if (!servers.length) return "";
  const index = servers.indexOf(current);
  return servers[(index + 1 + servers.length) % servers.length];
}

function isPlaybackStarted(message) {
  if (!message || typeof message !== "object" || message.type !== "PLAYER_EVENT") return false;
  const data = message.data && typeof message.data === "object" ? message.data : message;
  const state = String(data.player_status || data.event || data.status || "").toLowerCase();
  return state === "playing" || state === "play";
}

export function buildServerUrl(server, { type, id, season, episode, startAt = 0 } = {}) {
  const rawId = String(id || "").trim();
  if (!/^(?:\d+|tt\d+)$/i.test(rawId)) return "";
  const mediaId = encodeURIComponent(rawId);
  const isTv = type === "tv";
  const safeSeason = Math.max(1, Number.parseInt(season || "1", 10) || 1);
  const safeEpisode = Math.max(1, Number.parseInt(episode || "1", 10) || 1);
  const suffix = isTv ? "/tv/" + mediaId + "/" + safeSeason + "/" + safeEpisode : "/movie/" + mediaId;
  const resume = Number(startAt);
  const startAtQuery = Number.isFinite(resume) && resume > 5 ? String(Math.floor(resume)) : "";

  switch (server) {
    case "vidlink": {
      const path = isTv ? "/tv/" + mediaId + "/" + safeSeason + "/" + safeEpisode : "/movie/" + mediaId;
      const query = new URLSearchParams({ primaryColor: "e50914", secondaryColor: "1b1b1b", iconColor: "ffffff", title: "false", poster: "false" });
      if (startAtQuery) query.set("startAt", startAtQuery);
      return "https://vidlink.pro" + path + "?" + query;
    }
    case "vidsrc": {
      const query = new URLSearchParams();
      if (startAtQuery) query.set("startAt", startAtQuery);
      return "https://vidsrc.sh/embed" + suffix + (query.size ? "?" + query : "");
    }
    case "vidplus": {
      const path = isTv ? "/embed/tv/" + mediaId + "/" + safeSeason + "/" + safeEpisode : "/embed/movie/" + mediaId;
      const query = new URLSearchParams({ autoplay: "false", primarycolor: "e50914", secondarycolor: "171717", iconcolor: "ffffff" });
      if (startAtQuery) query.set("startAt", startAtQuery);
      return "https://player.vidplus.to" + path + "?" + query;
    }
    case "vidking": {
      const path = isTv ? "/embed/tv/" + mediaId + "/" + safeSeason + "/" + safeEpisode : "/embed/movie/" + mediaId;
      return "https://www.vidking.net" + path + "?color=e50914&autoplay=false";
    }
    default:
      return "";
  }
}

export function mountFlickv4WebPlayer(root) {
  if (!root) return;
  const serverSelect = $("#flickv4-server", root);
  const playButton = $("#flickv4-play", root);
  const stopButton = $("#flickv4-stop", root);
  const nextButton = $("#flickv4-next", root);
  const frame = $("#flickv4-iframe", root);
  const status = $("#flickv4-status", root);
  if (!serverSelect || !playButton || !stopButton || !frame || !status) return;

  const params = {
    id: root.dataset.tmdbId || root.dataset.mediaId,
    type: root.dataset.mediaType === "tv" ? "tv" : "movie",
    season: Math.max(1, Number.parseInt(root.dataset.season || "1", 10) || 1),
    episode: Math.max(1, Number.parseInt(root.dataset.episode || "1", 10) || 1),
    startAt: Number(root.dataset.startAt || 0),
  };

  let loadSequence = 0;
  let loadTimer = null;
  let timedOutSequence = 0;
  const clearLoadTimer = () => {
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer);
      loadTimer = null;
    }
  };

  const loadSelectedServer = () => {
    const url = buildServerUrl(serverSelect.value, params);
    if (!url || !/^https:\/\//i.test(url)) {
      status.hidden = false;
      status.textContent = "This server is not available for the selected title.";
      return;
    }
    const sequence = ++loadSequence;
    clearLoadTimer();
    timedOutSequence = 0;
    if (nextButton) nextButton.hidden = true;
    status.hidden = false;
    status.textContent = "Loading " + serverSelect.options[serverSelect.selectedIndex].text + "…";
    frame.hidden = false;
    frame.src = url;
    // A document load is not a playback signal. Keep the watchdog running until
    // the iframe reports that the video has actually started.
    loadTimer = window.setTimeout(() => {
      if (sequence !== loadSequence) return;
      timedOutSequence = sequence;
      loadTimer = null;
      status.hidden = false;
      status.textContent = "The player page loaded, but playback has not been confirmed. Try another server.";
      if (nextButton) nextButton.hidden = false;
    }, 18000);
  };

  playButton.addEventListener("click", loadSelectedServer);
  stopButton.addEventListener("click", () => {
    loadSequence += 1;
    timedOutSequence = 0;
    clearLoadTimer();
    if (nextButton) nextButton.hidden = true;
    frame.src = "about:blank";
    frame.hidden = true;
    status.hidden = false;
    status.textContent = "Playback stopped. Choose a server and press Play to start again.";
  });

  nextButton?.addEventListener("click", () => {
    const available = Array.from(serverSelect.options, option => option.value);
    const next = getNextServer(serverSelect.value, available);
    if (!next) return;
    serverSelect.value = next;
    loadSelectedServer();
  });

  serverSelect.addEventListener("change", () => {
    clearLoadTimer();
    loadSequence += 1;
    timedOutSequence = 0;
    if (nextButton) nextButton.hidden = true;
    status.hidden = false;
    status.textContent = "Selected " + serverSelect.options[serverSelect.selectedIndex].text + ". Press Play to start it.";
  });

  frame.addEventListener("error", () => {
    clearLoadTimer();
    status.hidden = false;
    status.textContent = "The selected server could not be loaded. Try another server.";
    if (nextButton) nextButton.hidden = false;
  });

  frame.addEventListener("load", () => {
    if (!frame.src || frame.src === "about:blank") return;
    // Loading provider HTML is not proof of playback. Do not clear the watchdog.
    if (timedOutSequence === loadSequence) return;
    status.hidden = false;
    status.textContent = "Player page loaded; waiting for playback…";
  });

  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow || !frame.src || frame.src === "about:blank") return;
    let expectedOrigin;
    try { expectedOrigin = new URL(frame.src).origin; } catch { return; }
    if (event.origin !== expectedOrigin || !isPlaybackStarted(event.data)) return;
    loadSequence += 1;
    timedOutSequence = 0;
    clearLoadTimer();
    if (nextButton) nextButton.hidden = true;
    status.hidden = true;
  });
}
