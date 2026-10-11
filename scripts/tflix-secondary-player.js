const STORAGE_KEY = "vivid:tflix-secondary-server:v1";
const SERVERS = Object.freeze([
  { id: "vixsrc", name: "VixSrc", alias: "Rakan", note: "Separate streaming source" },
  { id: "moviesapi", name: "MoviesAPI", alias: "Bard", note: "Alternative source" },
  { id: "vidsrc-embed", name: "VidSrc Embed", alias: "Xayah", note: "Alternate VidSrc endpoint" },
  { id: "cinesrc", name: "CineSRC", alias: "Ekko", note: "Alternative source" },
  { id: "vidfast", name: "VidFast", alias: "Naafiri", note: "Alternative source" },
  { id: "vidlink", name: "VidLink", alias: "Ryze", note: "Same provider family as the main player" }
]);
const positiveInteger = value => Math.max(1, Math.trunc(Number(value) || 1));
export function listTflixSecondaryServers() { return SERVERS.map(server => ({ ...server })); }
/** Independent implementation of public embed URL patterns used by TFLIX. */
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
  try { const value=localStorage.getItem(STORAGE_KEY); return SERVERS.some(server=>server.id===value)?value:"vixsrc"; }
  catch { return "vixsrc"; }
}
function rememberServer(serverId) { try { localStorage.setItem(STORAGE_KEY,serverId); } catch { /* Playback must work without storage. */ } }

export function mountTflixSecondaryPlayer({ root, params, media, title, isAnime = false } = {}) {
  if (!root) return null;
  const tmdbId=String(media?.id||params?.id||"").trim();
  if (isAnime||!/^\d+$/.test(tmdbId)||!["movie","tv"].includes(params?.type)) { root.hidden=true; return null; }
  root.hidden=false;
  root.innerHTML=
    '<div class="vivid-tflix-card">'+
      '<div class="vivid-tflix-heading"><div><span class="vivid-tflix-eyebrow">MORE PLAYBACK OPTIONS</span><h2>Player 2</h2><p>Separate streaming sources. Your main Vivid Cinema player and its servers stay unchanged.</p></div><span class="vivid-tflix-badge">Additional player</span></div>'+
      '<div class="vivid-tflix-screen" id="vivid-tflix-screen">'+
        '<div class="vivid-tflix-placeholder" id="vivid-tflix-placeholder"><i class="bi bi-play-circle" aria-hidden="true"></i><strong>Ready when you are</strong><span>Choose a server below, or start with your remembered server.</span><button type="button" id="vivid-tflix-start">Play with Player 2</button></div>'+
        '<iframe id="vivid-tflix-frame" title="Additional streaming player" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; web-share *" allowfullscreen referrerpolicy="origin" loading="eager" hidden></iframe>'+
        '<div class="vivid-tflix-status" id="vivid-tflix-status" role="status" aria-live="polite" hidden></div>'+
      '</div><div class="vivid-tflix-server-heading"><strong>Streaming servers</strong><span>Tap a server to switch</span></div>'+
      '<div class="vivid-tflix-server-grid" id="vivid-tflix-server-grid"></div>'+
      '<p class="vivid-tflix-footnote">These are third-party embeds, not streams hosted by Vivid Cinema. Availability, ads and mobile playback depend on each provider. If one stays blank, try another.</p></div>';
  const titleText=String(title||media?.title||media?.name||"Selected title");
  const frameHost=root.querySelector("#vivid-tflix-screen"), placeholder=root.querySelector("#vivid-tflix-placeholder");
  const startButton=root.querySelector("#vivid-tflix-start"), status=root.querySelector("#vivid-tflix-status"), grid=root.querySelector("#vivid-tflix-server-grid");
  let selectedServer=readRememberedServer(), generation=0, loadTimer=0;
  const playbackParams={id:tmdbId,tmdbId,type:params.type,season:positiveInteger(params.season),episode:positiveInteger(params.episode)};
  const serverButtons=new Map();
  function updateServerButtons() {
    for(const server of SERVERS){const button=serverButtons.get(server.id);if(!button)continue;const active=server.id===selectedServer;button.setAttribute("aria-pressed",active?"true":"false");const state=button.querySelector(".vivid-tflix-server-state");if(state)state.textContent=active?"Selected":"Ready";}
  }
  function setStatus(message,mode){status.textContent=message;status.hidden=false;status.classList.toggle("is-loading",mode==="loading");status.classList.toggle("is-compact",mode==="compact");}
  function loadServer(serverId) {
    const server=SERVERS.find(item=>item.id===serverId), url=buildTflixSecondaryServerUrl(serverId,playbackParams);
    if(!server||!url){setStatus("This title does not have a valid TMDB ID for this server.","compact");return;}
    generation++;const thisGeneration=generation;if(loadTimer)window.clearTimeout(loadTimer);
    selectedServer=serverId;rememberServer(serverId);updateServerButtons();placeholder.hidden=true;setStatus("Loading "+server.name+"…","loading");
    // Recreate the iframe on each switch so fullscreen permissions are delegated afresh.
    const frame=document.createElement("iframe");frame.id="vivid-tflix-frame";frame.title=titleText+" · "+server.name;
    frame.allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; web-share *";frame.allowFullscreen=true;frame.referrerPolicy="origin";frame.loading="eager";
    frame.addEventListener("load",()=>{if(thisGeneration!==generation)return;if(loadTimer)window.clearTimeout(loadTimer);setStatus(server.name+" loaded. If playback does not start, choose another server below.","compact");});
    frame.addEventListener("error",()=>{if(thisGeneration!==generation)return;if(loadTimer)window.clearTimeout(loadTimer);setStatus(server.name+" could not be loaded. Try another server.","compact");});
    const oldFrame=frameHost.querySelector("#vivid-tflix-frame");if(oldFrame)oldFrame.replaceWith(frame);else frameHost.appendChild(frame);
    frame.hidden=false;frame.src=url;
    loadTimer=window.setTimeout(()=>{if(thisGeneration!==generation)return;setStatus("Still waiting for "+server.name+"? The provider may be slow or unavailable. Try another server.","compact");},12000);
  }
  for(const server of SERVERS){
    const button=document.createElement("button");button.type="button";button.className="vivid-tflix-server";button.dataset.tflixServer=server.id;
    button.setAttribute("aria-pressed",server.id===selectedServer?"true":"false");
    button.innerHTML='<span class="vivid-tflix-server-dot" aria-hidden="true"></span><span class="vivid-tflix-server-copy"><strong></strong><small></small></span><span class="vivid-tflix-server-state"></span>';
    button.querySelector("strong").textContent=server.name;button.querySelector("small").textContent=server.alias+" · "+server.note;
    button.querySelector(".vivid-tflix-server-state").textContent=server.id===selectedServer?"Selected":"Ready";
    button.addEventListener("click",()=>loadServer(server.id));grid.appendChild(button);serverButtons.set(server.id,button);
  }
  startButton.addEventListener("click",()=>loadServer(selectedServer));updateServerButtons();
  return {loadServer,getSelectedServer:()=>selectedServer,destroy:()=>{generation++;if(loadTimer)window.clearTimeout(loadTimer);const frame=frameHost.querySelector("#vivid-tflix-frame");if(frame)frame.src="about:blank";}};
}
