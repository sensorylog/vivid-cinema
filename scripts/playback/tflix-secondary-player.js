const STORAGE_KEY = "vivid:tflix-secondary-server:v1";
const SERVERS = Object.freeze([
  { id: "vixsrc", name: "Rakan", provider: "VixSrc", note: "Generally better quality." },
  { id: "moviesapi", name: "Bard", provider: "MoviesAPI", note: "Recommended for recently released movies." },
  { id: "vidsrc-embed", name: "Xayah", provider: "VidSrc Embed", note: "Recommended for recently released movies." },
  { id: "cinesrc", name: "Ekko", provider: "CineSRC", note: "May have 4K. Generally better quality." },
  { id: "vidfast", name: "Naafiri", provider: "VidFast", note: "May have 4K. Generally better quality." },
  { id: "vidlink", name: "Ryze", provider: "VidLink", note: "Generally better quality." }
]);
const positiveInteger = value => Math.max(1, Math.trunc(Number(value) || 1));
export function listTflixSecondaryServers() { return SERVERS.map(server => ({ ...server })); }

/** Independently implemented embed routes matching TFLIX's public player choices. */
export function buildTflixSecondaryServerUrl(serverId, params = {}) {
  const id = String(params.tmdbId || params.id || "").trim();
  if (!/^\d+$/.test(id) || (params.type !== "movie" && params.type !== "tv")) return "";
  const isTv = params.type === "tv", season = positiveInteger(params.season), episode = positiveInteger(params.episode);
  switch (serverId) {
    case "vixsrc": return isTv ? "https://vixsrc.to/tv/" + id + "/" + season + "/" + episode + "?autoPlay=true&lang=en" : "https://vixsrc.to/movie/" + id + "?autoPlay=true&lang=en";
    case "moviesapi": return isTv ? "https://moviesapi.to/tv/" + id + "-" + season + "-" + episode : "https://moviesapi.to/movie/" + id;
    case "vidsrc-embed": return isTv ? "https://vidsrc-embed.ru/embed/tv?tmdb=" + id + "&season=" + season + "&episode=" + episode + "&autoplay=1" : "https://vidsrc-embed.ru/embed/movie?tmdb=" + id + "&autoplay=1";
    case "cinesrc": return isTv ? "https://cinesrc.st/embed/tv/" + id + "?s=" + season + "&e=" + episode + "&autoplay=true&autonext=true&prioritize=true&lastserver=wave" : "https://cinesrc.st/embed/movie/" + id + "?autoplay=true&prioritize=true&lastserver=wave";
    case "vidfast": return isTv ? "https://vidfast.vc/tv/" + id + "/" + season + "/" + episode + "?autoPlay=true" : "https://vidfast.vc/movie/" + id + "?autoPlay=true";
    case "vidlink": return isTv ? "https://vidlink.pro/tv/" + id + "/" + season + "/" + episode + "?title=true&poster=true&autoplay=true&nextbutton=true" : "https://vidlink.pro/movie/" + id + "?title=true&poster=true&autoplay=true";
    default: return "";
  }
}
function readRememberedServer() {
  try { const value = localStorage.getItem(STORAGE_KEY); return SERVERS.some(server => server.id === value) ? value : "vixsrc"; }
  catch { return "vixsrc"; }
}
function rememberServer(serverId) { try { localStorage.setItem(STORAGE_KEY, serverId); } catch { /* Player works without storage. */ } }

export function mountTflixSecondaryPlayer({ root, params, media, details, title, isAnime = false } = {}) {
  if (!root) return null;
  const tmdbId = String(media?.id || params?.id || "").trim();
  if (isAnime || !/^\d+$/.test(tmdbId) || !["movie", "tv"].includes(params?.type)) { root.hidden = true; return null; }
  root.hidden = false;
  const isTv = params.type === "tv";
  const titleText = String(title || media?.title || media?.name || "Selected title");
  const seasonData = Array.isArray(details?.seasons) ? details.seasons.filter(item => Number(item?.season_number) >= 0) : [];
  const currentSeason = positiveInteger(params.season);
  const currentEpisode = positiveInteger(params.episode);
  const initialSeason = seasonData.some(item => Number(item.season_number) === currentSeason) ? currentSeason : (seasonData.find(item => Number(item.season_number) > 0)?.season_number || 1);
  const episodeCount = season => Math.max(1, Number(seasonData.find(item => Number(item.season_number) === Number(season))?.episode_count) || (Number(season) === currentSeason ? currentEpisode : 1));
  root.innerHTML =
    '<div class="vivid-tflix-card">' +
      '<header class="vivid-tflix-topbar"><a class="vivid-tflix-logo" href="#vivid-tflix-player" aria-label="TFLIX-style secondary player">TFLIX</a><div class="vivid-tflix-now-title" id="vivid-tflix-now-title"></div><span class="vivid-tflix-player-tag">PLAYER 2</span></header>' +
      '<div class="vivid-tflix-layout"><div class="vivid-tflix-player-col">' +
        '<div class="vivid-tflix-screen" id="vivid-tflix-screen"><div class="vivid-tflix-loading" id="vivid-tflix-loading" hidden><span class="vivid-tflix-spinner"></span><span>Loading player…</span></div><div class="vivid-tflix-placeholder" id="vivid-tflix-placeholder"><i class="bi bi-play-circle" aria-hidden="true"></i><strong>Ready to stream</strong><span>Choose a server to begin playback.</span><button type="button" id="vivid-tflix-start">Start Player 2</button></div><iframe id="vivid-tflix-frame" title="Additional streaming player" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; web-share *" allowfullscreen referrerpolicy="origin" loading="eager" hidden></iframe><div class="vivid-tflix-status" id="vivid-tflix-status" role="status" aria-live="polite" hidden></div></div>' +
      '</div><aside class="vivid-tflix-sidebar">' +
        (isTv ? '<section class="vivid-tflix-panel" id="vivid-tflix-tv-panel"><div class="vivid-tflix-panel-title">Episode</div><div class="vivid-tflix-selectors"><label><span>Season</span><select id="vivid-tflix-season" class="vivid-tflix-select"></select></label><label><span>Episode</span><select id="vivid-tflix-episode" class="vivid-tflix-select"></select></label></div><button type="button" id="vivid-tflix-next" class="vivid-tflix-next">Next Episode <span aria-hidden="true">▶</span></button></section>' : '') +
        '<section class="vivid-tflix-panel"><div class="vivid-tflix-panel-title">Streaming Servers</div><div class="vivid-tflix-server-grid" id="vivid-tflix-server-grid"></div></section>' +
      '</aside></div><p class="vivid-tflix-footnote">Playback is provided by third-party embeds. If a server is unavailable or stays blank, select another server.</p></div>';
  const screen = root.querySelector("#vivid-tflix-screen");
  const placeholder = root.querySelector("#vivid-tflix-placeholder");
  const loading = root.querySelector("#vivid-tflix-loading");
  const status = root.querySelector("#vivid-tflix-status");
  const grid = root.querySelector("#vivid-tflix-server-grid");
  const nowTitle = root.querySelector("#vivid-tflix-now-title");
  let selectedServer = readRememberedServer(), generation = 0, loadTimer = 0;
  const playbackParams = { id: tmdbId, tmdbId, type: params.type, season: positiveInteger(params.season), episode: positiveInteger(params.episode) };
  const buttons = new Map();
  function updateTitle() {
    nowTitle.textContent = isTv ? titleText + " · S" + playbackParams.season + " E" + playbackParams.episode : titleText;
  }
  function updateButtons() {
    for (const server of SERVERS) {
      const button = buttons.get(server.id);
      if (!button) continue;
      const active = server.id === selectedServer;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }
  function setStatus(message, mode) {
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle("is-loading", mode === "loading");
  }
  function loadServer(serverId) {
    const server = SERVERS.find(item => item.id === serverId);
    const url = buildTflixSecondaryServerUrl(serverId, playbackParams);
    if (!server || !url) { setStatus("This title does not have a valid TMDB ID for this server."); return; }
    generation++;
    const thisGeneration = generation;
    if (loadTimer) window.clearTimeout(loadTimer);
    selectedServer = serverId;
    rememberServer(serverId);
    updateButtons();
    placeholder.hidden = true;
    loading.hidden = false;
    status.hidden = true;
    const frame = document.createElement("iframe");
    frame.id = "vivid-tflix-frame";
    frame.title = titleText + " · " + server.name;
    frame.allow = "autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; web-share *";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "origin";
    frame.loading = "eager";
    frame.addEventListener("load", () => {
      if (thisGeneration !== generation) return;
      if (loadTimer) window.clearTimeout(loadTimer);
      loading.hidden = true;
      setStatus(server.name + " loaded. If playback does not start, try another server.");
      window.setTimeout(() => { if (thisGeneration === generation) status.hidden = true; }, 5000);
    });
    frame.addEventListener("error", () => {
      if (thisGeneration !== generation) return;
      if (loadTimer) window.clearTimeout(loadTimer);
      loading.hidden = true;
      setStatus(server.name + " could not be loaded. Try another server.");
    });
    const oldFrame = screen.querySelector("#vivid-tflix-frame");
    if (oldFrame) oldFrame.replaceWith(frame); else screen.appendChild(frame);
    frame.hidden = false;
    frame.src = url;
    loadTimer = window.setTimeout(() => {
      if (thisGeneration !== generation) return;
      loading.hidden = true;
      setStatus("Still waiting for " + server.name + "? The provider may be slow or unavailable.");
    }, 12000);
  }
  for (const server of SERVERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vivid-tflix-server" + (server.id === selectedServer ? " selected" : "");
    button.dataset.tflixServer = server.id;
    button.setAttribute("aria-pressed", server.id === selectedServer ? "true" : "false");
    button.innerHTML = '<span class="vivid-tflix-server-dot" aria-hidden="true"></span><span class="vivid-tflix-server-copy"><strong></strong><small></small></span>';
    button.querySelector("strong").textContent = server.name;
    button.querySelector("small").textContent = server.note;
    button.addEventListener("click", () => loadServer(server.id));
    grid.appendChild(button);
    buttons.set(server.id, button);
  }
  if (isTv) {
    const seasonSelect = root.querySelector("#vivid-tflix-season");
    const episodeSelect = root.querySelector("#vivid-tflix-episode");
    const nextButton = root.querySelector("#vivid-tflix-next");
    const seasons = seasonData.length ? seasonData.filter(item => Number(item.season_number) > 0) : [{ season_number: initialSeason, episode_count: episodeCount(initialSeason) }];
    seasonSelect.innerHTML = seasons.map(item => '<option value="' + Number(item.season_number) + '">Season ' + Number(item.season_number) + ' · ' + Math.max(1, Number(item.episode_count) || 1) + ' ep</option>').join("");
    seasonSelect.value = String(initialSeason);
    function fillEpisodes() {
      const count = episodeCount(seasonSelect.value);
      episodeSelect.innerHTML = Array.from({ length: count }, (_, index) => '<option value="' + (index + 1) + '">Episode ' + (index + 1) + '</option>').join("");
      episodeSelect.value = String(Math.min(positiveInteger(playbackParams.episode), count));
    }
    function goToEpisode(season, episode) {
      const url = new URL(window.location.href);
      url.searchParams.set("type", "tv");
      url.searchParams.set("id", tmdbId);
      url.searchParams.set("season", String(positiveInteger(season)));
      url.searchParams.set("episode", String(positiveInteger(episode)));
      window.location.href = url.pathname + url.search + url.hash;
    }
    fillEpisodes();
    seasonSelect.addEventListener("change", () => { fillEpisodes(); goToEpisode(seasonSelect.value, 1); });
    episodeSelect.addEventListener("change", () => goToEpisode(seasonSelect.value, episodeSelect.value));
    nextButton.addEventListener("click", () => {
      const count = episodeCount(playbackParams.season);
      if (playbackParams.episode < count) goToEpisode(playbackParams.season, playbackParams.episode + 1);
      else {
        const next = seasons.find(item => Number(item.season_number) > playbackParams.season);
        if (next) goToEpisode(next.season_number, 1);
        else setStatus("No next episode is listed for this season.");
      }
    });
  }
  updateTitle();
  updateButtons();
  const startButton = root.querySelector("#vivid-tflix-start");
  if (startButton) startButton.addEventListener("click", () => loadServer(selectedServer));
  let started = false;
  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return;
      started = true;
      observer.disconnect();
      loadServer(selectedServer);
    }, { rootMargin: "100px" });
    observer.observe(root);
  } else if (startButton) {
    startButton.hidden = false;
  }
  return { loadServer, getSelectedServer: () => selectedServer, destroy: () => { generation++; if (loadTimer) window.clearTimeout(loadTimer); if (observer) observer.disconnect(); const frame = screen.querySelector("#vivid-tflix-frame"); if (frame) frame.src = "about:blank"; } };
}
