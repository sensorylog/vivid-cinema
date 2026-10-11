import { tmdbApi } from "../tmdb.js";

const STORAGE_KEY = "vivid:tflix-secondary-server:v1";
const SERVERS = Object.freeze([
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
    case "moviesapi": return isTv ? "https://moviesapi.to/tv/" + id + "-" + season + "-" + episode : "https://moviesapi.to/movie/" + id;
    case "vidsrc-embed": return isTv ? "https://vidsrc-embed.ru/embed/tv?tmdb=" + id + "&season=" + season + "&episode=" + episode + "&autoplay=1" : "https://vidsrc-embed.ru/embed/movie?tmdb=" + id + "&autoplay=1";
    case "cinesrc": return isTv ? "https://cinesrc.st/embed/tv/" + id + "?s=" + season + "&e=" + episode + "&autoplay=true&autonext=true&prioritize=true&lastserver=wave" : "https://cinesrc.st/embed/movie/" + id + "?autoplay=true&prioritize=true&lastserver=wave";
    case "vidfast": return isTv ? "https://vidfast.vc/tv/" + id + "/" + season + "/" + episode + "?autoPlay=true" : "https://vidfast.vc/movie/" + id + "?autoPlay=true";
    case "vidlink": return isTv ? "https://vidlink.pro/tv/" + id + "/" + season + "/" + episode + "?title=true&poster=true&autoplay=true&nextbutton=true" : "https://vidlink.pro/movie/" + id + "?title=true&poster=true&autoplay=true";
    default: return "";
  }
}
function readRememberedServer() {
  try { const value = localStorage.getItem(STORAGE_KEY); return SERVERS.some(server => server.id === value) ? value : "moviesapi"; }
  catch { return "moviesapi"; }
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
      '<header class="vivid-tflix-topbar"><a class="vivid-player-brand" href="#vivid-tflix-player" aria-label="Vivid Cinema secondary player">Vivid<span>Cinema</span></a><div class="vivid-tflix-now-title" id="vivid-tflix-now-title"></div><span class="vivid-tflix-player-tag">PLAYER 2</span></header>' +
      '<div class="vivid-tflix-layout"><div class="vivid-tflix-player-col">' +
        '<div class="vivid-tflix-screen" id="vivid-tflix-screen"><div class="vivid-tflix-loading" id="vivid-tflix-loading" hidden><span class="vivid-tflix-spinner"></span><span>Loading player…</span></div><div class="vivid-tflix-placeholder" id="vivid-tflix-placeholder"><i class="bi bi-play-circle" aria-hidden="true"></i><strong>Ready to stream</strong><span>Choose a server to begin playback.</span><button type="button" id="vivid-tflix-start">Start playback</button></div><iframe id="vivid-tflix-frame" title="Additional streaming player" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; web-share *" allowfullscreen referrerpolicy="origin" loading="eager" hidden></iframe><div class="vivid-tflix-status" id="vivid-tflix-status" role="status" aria-live="polite" hidden></div></div>' +
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
  let selectedServer = readRememberedServer(), generation = 0, loadTimer = 0, started = false;
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
    started = true;
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
    const seasons = seasonData.filter(item => Number(item.season_number) > 0)
      .sort((a, b) => Number(a.season_number) - Number(b.season_number));
    if (!seasons.length) seasons.push({ season_number: initialSeason, episode_count: episodeCount(initialSeason) });
    seasonSelect.innerHTML = seasons.map(item => '<option value="' + Number(item.season_number) + '">Season ' + Number(item.season_number) + '</option>').join("");
    seasonSelect.value = String(seasons.some(item => Number(item.season_number) === initialSeason) ? initialSeason : seasons[0].season_number);
    let episodeData = [];
    const currentSeasonSummary = season => seasons.find(item => Number(item.season_number) === Number(season));
    function updateUrl() {
      const url = new URL(window.location.href);
      url.searchParams.set("type", "tv");
      url.searchParams.set("id", tmdbId);
      url.searchParams.set("season", String(playbackParams.season));
      url.searchParams.set("episode", String(playbackParams.episode));
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    function populateEpisodes(episodes, preferredEpisode) {
      episodeData = Array.isArray(episodes) ? episodes.filter(ep => Number(ep?.episode_number) > 0)
        .sort((a, b) => Number(a.episode_number) - Number(b.episode_number)) : [];
      if (episodeData.length) {
        episodeSelect.innerHTML = episodeData.map(ep => {
          const number = Number(ep.episode_number);
          const name = String(ep.name || "").trim();
          const label = "Episode " + number + (name ? " · " + name : "");
          return '<option value="' + number + '">' + label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</option>';
        }).join("");
      } else {
        const count = Math.max(1, Number(currentSeasonSummary(seasonSelect.value)?.episode_count) || 1);
        episodeSelect.innerHTML = Array.from({ length: count }, (_, index) => '<option value="' + (index + 1) + '">Episode ' + (index + 1) + '</option>').join("");
      }
      const available = Array.from(episodeSelect.options).map(option => Number(option.value));
      const target = available.includes(Number(preferredEpisode)) ? Number(preferredEpisode) : (available[0] || 1);
      episodeSelect.value = String(target);
      playbackParams.season = positiveInteger(seasonSelect.value);
      playbackParams.episode = target;
      updateTitle();
    }
    function selectEpisode(season, episode) {
      playbackParams.season = positiveInteger(season);
      playbackParams.episode = positiveInteger(episode);
      seasonSelect.value = String(playbackParams.season);
      if (String(episodeSelect.value) !== String(playbackParams.episode)) episodeSelect.value = String(playbackParams.episode);
      updateTitle();
      updateUrl();
      if (started) {
        loadServer(selectedServer);
      } else {
        placeholder.hidden = false;
        loading.hidden = true;
        setStatus("Selected Season " + playbackParams.season + ", Episode " + playbackParams.episode + ". Tap Start playback when ready.");
      }
    }
    async function fetchSeasonEpisodes(seasonNumber, preferredEpisode = 1) {
      playbackParams.season = positiveInteger(seasonNumber);
      seasonSelect.value = String(playbackParams.season);
      setStatus("Loading episode list…", "loading");
      try {
        const season = await tmdbApi.tvSeason(tmdbId, playbackParams.season);
        populateEpisodes(season.episodes || [], preferredEpisode);
        status.hidden = true;
      } catch {
        populateEpisodes([], preferredEpisode);
        setStatus("Episode names are temporarily unavailable. You can still choose an episode number.");
      }
    }
    seasonSelect.addEventListener("change", async () => {
      const season = positiveInteger(seasonSelect.value);
      await fetchSeasonEpisodes(season, 1);
      selectEpisode(season, positiveInteger(episodeSelect.value));
    });
    episodeSelect.addEventListener("change", () => selectEpisode(seasonSelect.value, episodeSelect.value));
    nextButton.addEventListener("click", async () => {
      const currentIndex = episodeData.findIndex(ep => Number(ep.episode_number) === playbackParams.episode);
      if (currentIndex >= 0 && currentIndex + 1 < episodeData.length) {
        selectEpisode(playbackParams.season, episodeData[currentIndex + 1].episode_number);
        return;
      }
      const nextSeason = seasons.find(item => Number(item.season_number) > playbackParams.season);
      if (nextSeason) {
        await fetchSeasonEpisodes(nextSeason.season_number, 1);
        selectEpisode(nextSeason.season_number, positiveInteger(episodeSelect.value));
      } else {
        setStatus("No next episode is listed for this series.");
      }
    });
    void fetchSeasonEpisodes(playbackParams.season, playbackParams.episode).then(() => {
      seasonSelect.value = String(playbackParams.season);
      episodeSelect.value = String(playbackParams.episode);
      updateTitle();
    });
  }
  updateTitle();
  updateButtons();
  const startButton = root.querySelector("#vivid-tflix-start");
  if (startButton) startButton.addEventListener("click", () => loadServer(selectedServer));
  // Player 2 loads only after an explicit tap on Start playback or a server choice.
  return { loadServer, getSelectedServer: () => selectedServer, destroy: () => { generation++; if (loadTimer) window.clearTimeout(loadTimer); const frame = screen.querySelector("#vivid-tflix-frame"); if (frame) frame.src = "about:blank"; } };
}
