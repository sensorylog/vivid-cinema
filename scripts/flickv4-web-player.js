const $ = (root, id) => root?.querySelector("#" + id);

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
  const clearLoadTimer = () => {
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer);
      loadTimer = null;
    }
  };

  const loadSelectedServer = () => {
    const url = buildServerUrl(serverSelect.value, params);
    if (!url || !/^https:\/\//i.test(url)) {
      status.textContent = "This server is not available for the selected title.";
      return;
    }
    const sequence = ++loadSequence;
    clearLoadTimer();
    status.textContent = "Loading " + serverSelect.options[serverSelect.selectedIndex].text + "…";
    frame.hidden = false;
    frame.src = url;
    loadTimer = window.setTimeout(() => {
      if (sequence !== loadSequence) return;
      status.textContent = "This server is taking too long to respond. Try another server.";
      loadTimer = null;
    }, 15000);
  };

  playButton.addEventListener("click", loadSelectedServer);
  stopButton.addEventListener("click", () => {
    loadSequence += 1;
    clearLoadTimer();
    frame.src = "about:blank";
    frame.hidden = true;
    status.textContent = "Playback stopped. Choose a server and press Play to start again.";
  });
  serverSelect.addEventListener("change", () => {
    status.textContent = "Selected " + serverSelect.options[serverSelect.selectedIndex].text + ". Press Play to load it.";
  });
  frame.addEventListener("error", () => {
    clearLoadTimer();
    status.textContent = "The selected server could not be loaded. Try another server.";
  });
  frame.addEventListener("load", () => {
    if (!frame.src || frame.src === "about:blank") return;
    clearLoadTimer();
    status.textContent = "Server page loaded. If video does not start, try another server.";
  });
}
