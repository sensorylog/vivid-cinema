const $ = (root, id) => root?.querySelector("#" + id);

function buildServerUrl(server, { type, id, season, episode, imdbId }) {
  const mediaId = encodeURIComponent(String(id || ""));
  const isTv = type === "tv";
  const suffix = isTv ? "/tv/" + mediaId + "/" + season + "/" + episode : "/movie/" + mediaId;
  const imdb = /^tt\d+$/i.test(String(imdbId || "")) ? encodeURIComponent(imdbId) : "";
  switch (server) {
    case "vidlink": {
      const base = "https://vidlink.pro";
      const path = isTv ? "/tv/" + (imdb || mediaId) + "/" + season + "/" + episode : "/movie/" + (imdb || mediaId);
      const query = new URLSearchParams({ primaryColor: "e50914", secondaryColor: "1b1b1b", iconColor: "ffffff", title: "false", poster: "false" });
      return base + path + "?" + query;
    }
    case "vidsrc":
      return "https://vidsrc.sh/embed" + suffix;
    case "vidplus": {
      const path = isTv ? "/embed/tv/" + mediaId + "/" + season + "/" + episode : "/embed/movie/" + mediaId;
      return "https://player.vidplus.to" + path + "?autoplay=false&primarycolor=e50914&secondarycolor=171717&iconcolor=ffffff";
    }
    case "vidking": {
      const path = isTv ? "/embed/tv/" + mediaId + "/" + season + "/" + episode : "/embed/movie/" + mediaId;
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
    imdbId: root.dataset.imdbId || "",
  };

  const loadSelectedServer = () => {
    const url = buildServerUrl(serverSelect.value, params);
    if (!url || !/^https:\/\//i.test(url)) {
      status.textContent = "This server is not available for the selected title.";
      return;
    }
    status.textContent = "Loading " + serverSelect.options[serverSelect.selectedIndex].text + "…";
    frame.src = url;
    frame.hidden = false;
  };

  playButton.addEventListener("click", loadSelectedServer);
  stopButton.addEventListener("click", () => {
    frame.src = "about:blank";
    frame.hidden = true;
    status.textContent = "Playback stopped. Choose a server and press Play to start again.";
  });
  serverSelect.addEventListener("change", () => {
    status.textContent = "Selected " + serverSelect.options[serverSelect.selectedIndex].text + ". Press Play to load it.";
  });
  frame.addEventListener("load", () => {
    if (frame.src && frame.src !== "about:blank") {
      status.textContent = "Server page loaded. If video does not start, try another server.";
    }
  });
}
