import { getLocalLibrary, clearLibraryCollection, removeLibraryItem, startLibrarySync } from "./library.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import { getContinueWatching, formatProgress } from "./recommendations.js";

let activeCollection = "favorites";
const $ = (id) => document.getElementById(id);

function renderContinueWatching() {
  const section = $("library-continue");
  const rail = $("library-continue-rail");
  if (!section || !rail) return;
  const items = getContinueWatching(8);
  if (!items.length) {
    section.hidden = true;
    rail.innerHTML = "";
    return;
  }
  section.hidden = false;
  rail.innerHTML = items.map((item) => {
    const type = item.media_type || item.mediaType || "movie";
    const title = item.title || item.name || "Untitled";
    const url = getMediaUrl({id:item.id, media_type:type});
    const progress = formatProgress(item);
    const episode = type === "tv" && item.season && item.episode ? "S" + item.season + " · E" + item.episode : (type === "tv" ? "TV series" : "Movie");
    return '<a class="vivid-library-continue-card" href="' + escapeHtml(url) + '">' +
      '<div class="vivid-library-continue-art"><img loading="lazy" src="' + getImageUrl(item.backdrop_path || item.poster_path, "w780") + '" alt="' + escapeHtml(title) + '"></div>' +
      '<div class="vivid-library-continue-copy"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(episode) + ' · ' + escapeHtml(progress) + ' watched</span></div>' +
      '<span class="vivid-library-progress"><i style="width:' + escapeHtml(progress) + '"></i></span>' +
      '<span class="vivid-library-play" aria-hidden="true"><i class="bi bi-play-fill"></i></span>' +
    '</a>';
  }).join("");
}

function render() {
  renderContinueWatching();
  const library = getLocalLibrary();
  ["favorites","watchLater","history"].forEach((key) => {
    const count = document.querySelector("[data-count=\"" + key + "\"]");
    if (count) count.textContent = String((library[key] || []).length);
  });
  const items = library[activeCollection] || [];
  const list = $("library-list");
  if (!items.length) {
    const copy = activeCollection === "favorites"
      ? ["No likes yet","Like titles from their detail page and they will appear here.","Discover titles"]
      : activeCollection === "watchLater"
        ? ["Your watch-later list is empty","Save something you want to come back to.","Browse movies & TV"]
        : ["No recent history","Titles you open will appear here for quick access.","Start browsing"];
    list.innerHTML = '<div class="vivid-library-empty"><i class="bi bi-bookmark"></i><h2>'+copy[0]+'</h2><p>'+copy[1]+'</p><a class="vivid-button vivid-button--primary" href="discover.html">'+copy[2]+'</a></div>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const type=item.media_type||item.mediaType||"movie", url=getMediaUrl({id:item.id,media_type:type}), title=item.title||item.name||"Untitled";
    const meta=[type==="tv"?"TV":"Movie",item.year||""].filter(Boolean).join(" · ");
    return '<article class="vivid-library-card"><a href="'+escapeHtml(url)+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(title)+' poster"><div class="vivid-library-card-copy"><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(meta)+'</small></div></a><button class="vivid-library-remove" type="button" data-remove-id="'+escapeHtml(String(item.id))+'" data-remove-type="'+escapeHtml(type)+'" aria-label="Remove '+escapeHtml(title)+'"><i class="bi bi-x-lg"></i></button></article>';
  }).join("");
  list.querySelectorAll("[data-remove-id]").forEach((button) => button.addEventListener("click",(event)=>{
    event.preventDefault(); event.stopPropagation(); removeLibraryItem(activeCollection,button.dataset.removeId,button.dataset.removeType); render();
  }));
}

document.addEventListener("DOMContentLoaded",async()=>{
  const syncStatus=document.getElementById("library-sync-status"); const syncDot=document.getElementById("library-sync-dot");
  const setSync=(message,state)=>{if(syncStatus)syncStatus.textContent=message;if(syncDot)syncDot.dataset.state=state;};
  setSync("Checking cloud library…","syncing");
  renderContinueWatching();
  try{await startLibrarySync();setSync("Synced to your account or saved locally.","success");}catch{setSync("Local library available. Cloud sync is unavailable.","error");}
  document.querySelectorAll("[data-library-tab]").forEach((tab)=>tab.addEventListener("click",()=>{
    activeCollection=tab.dataset.libraryTab;
    document.querySelectorAll("[data-library-tab]").forEach((item)=>{const active=item===tab;item.classList.toggle("is-active",active);item.setAttribute("aria-selected",String(active));});
    render();
    renderContinueWatching();
  }));
  $("library-clear")?.addEventListener("click",()=>{
    if(getLocalLibrary()[activeCollection]?.length&&window.confirm("Clear this library list on this device?")){clearLibraryCollection(activeCollection);render();renderContinueWatching();}
  });
  render();
});