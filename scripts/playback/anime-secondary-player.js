const STORAGE_KEY = "vivid:anime-player-2:v1";
const SERVERS = Object.freeze([
  { id: "anixo", name: "AniXo", note: "AniList and MAL · automatic upstream failover" },
  { id: "anilink", name: "AniLink", note: "AniList · sub/dub variants" },
  { id: "megaplay", name: "MegaPlay", note: "AniList and MAL · episode embeds" },
  { id: "megavid", name: "Megavid", note: "AniList and MAL · episode embeds" },
  { id: "megaflix", name: "MegaFlix", note: "AniList and MAL · episode embeds" }
]);
const positiveInteger = value => Math.max(1, Math.trunc(Number(value) || 1));
const numericId = value => /^\d+$/.test(String(value || "").trim()) ? String(value).trim() : "";

export function listAnimeSecondaryServers() {
  return SERVERS.map(server => ({ ...server }));
}

export function buildAnimeSecondaryServerUrl(serverId, { aniListId, malId, episode = 1, track = "sub" } = {}) {
  const ani = numericId(aniListId);
  const mal = numericId(malId);
  const ep = positiveInteger(episode);
  const audio = track === "dub" ? "dub" : "sub";
  switch (serverId) {
    case "anixo":
      if (ani) return "https://anixo.buzz/embed/ani/" + ani + "/" + ep + "?track=" + audio;
      if (mal) return "https://anixo.buzz/embed/mal/" + mal + "/" + ep + "?track=" + audio;
      return "";
    case "anilink":
      return ani ? "https://anilink.cc/watch/" + ani + "/" + ep + "?variant=" + audio : "";
    case "megaplay":
      if (ani) return "https://ani.megaplay.su/ani/" + ani + "/" + ep + "/" + audio;
      return mal ? "https://ani.megaplay.su/mal/" + mal + "/" + ep + "/" + audio : "";
    case "megavid":
      if (ani) return "https://megavid.buzz/ani/" + ani + "/" + ep + "/" + audio;
      return mal ? "https://megavid.buzz/mal/" + mal + "/" + ep + "/" + audio : "";
    case "megaflix":
      if (ani) return "https://megaflix.buzz/stream/ani/" + ani + "/" + ep + "/" + audio;
      return mal ? "https://megaflix.buzz/stream/mal/" + mal + "/" + ep + "/" + audio : "";
    default:
      return "";
  }
}

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      server: SERVERS.some(item => item.id === value.server) ? value.server : "anixo",
      track: value.track === "dub" ? "dub" : "sub"
    };
  } catch {
    return { server: "anixo", track: "sub" };
  }
}

function savePreferences(server, track) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ server, track })); } catch { /* Optional preference only. */ }
}

export function mountAnimeSecondaryPlayer({ root, params, media, title, aniListId, malId } = {}) {
  if (!root) return null;
  const isAnime = params?.anime === true || params?.anime === "1" || params?.isAnime === true;
  const ani = numericId(aniListId);
  const mal = numericId(malId);
  if (!isAnime || (!ani && !mal)) {
    root.hidden = true;
    root.innerHTML = "";
    return null;
  }

  const episode = positiveInteger(params?.episode);
  const titleText = String(title || media?.title || media?.name || "Anime");
  const initial = readPreferences();
  let selectedServer = initial.server;
  let track = initial.track;
  let generation = 0;
  let timer = 0;

  root.hidden = false;
  root.innerHTML =
    '<style>' +
    '.vivid-anime-p2{margin:24px 0;padding:0;background:#101116;border:1px solid #30323b;border-radius:16px;overflow:hidden;color:#f5f5f7;font-family:inherit}' +
    '.vivid-anime-p2 *{box-sizing:border-box}.vivid-anime-p2-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #30323b;flex-wrap:wrap}' +
    '.vivid-anime-p2-brand{font-weight:800;letter-spacing:.02em}.vivid-anime-p2-brand span{color:#a9a9b4}.vivid-anime-p2-tag{margin-left:auto;border:1px solid #555866;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;letter-spacing:.08em}' +
    '.vivid-anime-p2-title{flex:1;min-width:140px;font-size:13px;color:#c5c6d0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.vivid-anime-p2-layout{display:grid;grid-template-columns:minmax(0,1fr) 250px}.vivid-anime-p2-screen{position:relative;aspect-ratio:16/9;min-height:180px;background:#050506}' +
    '.vivid-anime-p2-screen iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#050506}.vivid-anime-p2-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:22px;text-align:center;color:#c7c7d1}' +
    '.vivid-anime-p2-placeholder strong{font-size:18px;color:#fff}.vivid-anime-p2-placeholder button,.vivid-anime-p2-track button{border:1px solid #626575;background:#22242d;color:#fff;border-radius:9px;padding:9px 13px;font:inherit;cursor:pointer}' +
    '.vivid-anime-p2-side{padding:15px;border-left:1px solid #30323b}.vivid-anime-p2-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#aaaab6;font-weight:800;margin:0 0 10px}' +
    '.vivid-anime-p2-track{display:flex;gap:8px;margin-bottom:16px}.vivid-anime-p2-track button{flex:1}.vivid-anime-p2-track button[aria-pressed=true],.vivid-anime-p2-server.selected{border-color:#a9e8de;background:#173b39}' +
    '.vivid-anime-p2-servers{display:grid;gap:8px}.vivid-anime-p2-server{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:1px solid #383a45;border-radius:10px;padding:10px;background:#191a21;color:#fff;font:inherit;cursor:pointer}' +
    '.vivid-anime-p2-dot{width:8px;height:8px;border-radius:50%;background:#747786;flex:none}.vivid-anime-p2-server.selected .vivid-anime-p2-dot{background:#a9e8de}.vivid-anime-p2-server-copy{display:grid;gap:3px;min-width:0}.vivid-anime-p2-server-copy strong{font-size:13px}.vivid-anime-p2-server-copy small{font-size:11px;line-height:1.35;color:#b0b1bd}' +
    '.vivid-anime-p2-status{padding:10px 15px;border-top:1px solid #30323b;color:#c5c6d0;font-size:12px}.vivid-anime-p2-foot{padding:12px 16px;color:#a7a8b3;font-size:12px;border-top:1px solid #30323b}' +
    '@media(max-width:760px){.vivid-anime-p2-layout{grid-template-columns:1fr}.vivid-anime-p2-side{border-left:0;border-top:1px solid #30323b}.vivid-anime-p2-screen{min-height:0}.vivid-anime-p2-servers{grid-template-columns:repeat(2,minmax(0,1fr))}.vivid-anime-p2-server{padding:9px}}' +
    '</style>' +
    '<div class="vivid-anime-p2"><header class="vivid-anime-p2-head"><div class="vivid-anime-p2-brand">Vivid<span> Cinema</span></div><div class="vivid-anime-p2-title"></div><span class="vivid-anime-p2-tag">ANIME · PLAYER 2</span></header>' +
    '<div class="vivid-anime-p2-layout"><div><div class="vivid-anime-p2-screen"><div class="vivid-anime-p2-placeholder"><strong>Anime Player 2</strong><span>Choose a server or start playback.</span><button type="button" data-anime-p2-start>Start playback</button></div></div></div>' +
    '<aside class="vivid-anime-p2-side"><p class="vivid-anime-p2-label">Audio</p><div class="vivid-anime-p2-track"><button type="button" data-anime-p2-track="sub" aria-pressed="true">Sub</button><button type="button" data-anime-p2-track="dub" aria-pressed="false">Dub</button></div>' +
    '<p class="vivid-anime-p2-label">Streaming servers</p><div class="vivid-anime-p2-servers"></div></aside></div><div class="vivid-anime-p2-status" role="status" aria-live="polite">Ready · select a server to load its player.</div>' +
    '<div class="vivid-anime-p2-foot">Player 2 is independent of Anime Player 1. If a provider is unavailable, choose another server. Third-party availability can change.</div></div>';

  const screen = root.querySelector(".vivid-anime-p2-screen");
  const placeholder = root.querySelector(".vivid-anime-p2-placeholder");
  const serverGrid = root.querySelector(".vivid-anime-p2-servers");
  const status = root.querySelector(".vivid-anime-p2-status");
  const titleNode = root.querySelector(".vivid-anime-p2-title");
  titleNode.textContent = titleText + " · Episode " + episode;
  const buttons = new Map();

  function updateButtons() {
    for (const server of SERVERS) {
      const button = buttons.get(server.id);
      if (!button) continue;
      const url = buildAnimeSecondaryServerUrl(server.id, { aniListId: ani, malId: mal, episode, track });
      button.disabled = !url;
      button.classList.toggle("selected", server.id === selectedServer);
      button.setAttribute("aria-pressed", String(server.id === selectedServer));
      button.title = url ? server.note : "This provider requires an AniList ID for this anime.";
      button.querySelector("small").textContent = url ? server.note : "Unavailable · ID not supported";
    }
    root.querySelectorAll("[data-anime-p2-track]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.animeP2Track === track));
    });
  }

  function setStatus(message) { status.textContent = message; }

  function loadServer(serverId) {
    const server = SERVERS.find(item => item.id === serverId);
    const url = buildAnimeSecondaryServerUrl(serverId, { aniListId: ani, malId: mal, episode, track });
    if (!server || !url) {
      setStatus("This server cannot resolve this anime's available catalog ID.");
      return false;
    }
    generation += 1;
    const thisGeneration = generation;
    if (timer) window.clearTimeout(timer);
    selectedServer = serverId;
    savePreferences(selectedServer, track);
    updateButtons();
    placeholder.hidden = true;
    screen.querySelector("iframe")?.remove();
    const frame = document.createElement("iframe");
    frame.title = titleText + " · Episode " + episode + " · " + server.name;
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "origin";
    frame.loading = "eager";
    frame.addEventListener("load", () => {
      if (thisGeneration !== generation) return;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      setStatus(server.name + " page loaded. If video does not start, switch to another server.");
    });
    frame.addEventListener("error", () => {
      if (thisGeneration !== generation) return;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      setStatus(server.name + " failed to load. Try another server.");
    });
    screen.appendChild(frame);
    frame.src = url;
    setStatus("Loading " + server.name + " · " + track.toUpperCase() + "…");
    timer = window.setTimeout(() => {
      if (thisGeneration !== generation) return;
      setStatus(server.name + " is taking a while. The iframe may load without the video starting; try another server if needed.");
    }, 12000);
    return true;
  }

  for (const server of SERVERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vivid-anime-p2-server";
    button.dataset.animeP2Server = server.id;
    button.innerHTML = '<span class="vivid-anime-p2-dot" aria-hidden="true"></span><span class="vivid-anime-p2-server-copy"><strong></strong><small></small></span>';
    button.querySelector("strong").textContent = server.name;
    button.querySelector("small").textContent = server.note;
    button.addEventListener("click", () => loadServer(server.id));
    serverGrid.appendChild(button);
    buttons.set(server.id, button);
  }
  root.querySelectorAll("[data-anime-p2-track]").forEach(button => {
    button.addEventListener("click", () => {
      const nextTrack = button.dataset.animeP2Track === "dub" ? "dub" : "sub";
      if (nextTrack === track) return;
      track = nextTrack;
      savePreferences(selectedServer, track);
      updateButtons();
      if (screen.querySelector("iframe")) loadServer(selectedServer);
      else setStatus("Audio changed to " + track.toUpperCase() + ". Start playback when ready.");
    });
  });
  root.querySelector("[data-anime-p2-start]")?.addEventListener("click", () => loadServer(selectedServer));
  updateButtons();
  return {
    loadServer,
    getSelectedServer: () => selectedServer,
    destroy: () => {
      generation += 1;
      if (timer) window.clearTimeout(timer);
      const frame = screen.querySelector("iframe");
      if (frame) frame.src = "about:blank";
      root.innerHTML = "";
      root.hidden = true;
    }
  };
}
