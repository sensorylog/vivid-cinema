import { getLocalLibrary, clearLibraryCollection, removeLibraryItem, startLibrarySync } from "./library.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import { getContinueWatching, formatProgress } from "./recommendations.js";
import { filterAllowedTitles } from "./parental-controls.js";

let activeCollection = "favorites"; // Library shelf state
let renderRevision = 0;
const $ = (id) => document.getElementById(id);

function renderContinueWatching(items = []) {
  const section = $("library-continue");
  const rail = $("library-continue-rail");
  if (!section || !rail) return;
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

async function render() {
  const revision = ++renderRevision;
  const source = getLocalLibrary();
  try {
    const [favorites, watchLater, history, continueItems] = await Promise.all([
      filterAllowedTitles(source.favorites || []),
      filterAllowedTitles(source.watchLater || []),
      filterAllowedTitles(source.history || []),
      filterAllowedTitles(getContinueWatching(8))
    ]);
    if (revision !== renderRevision) return;
    const library = { favorites, watchLater, history };
    renderContinueWatching(continueItems);
    ["favorites","watchLater","history"].forEach((key) => {
      const count = document.querySelector("[data-count=\"" + key + "\"]");
      if (count) count.textContent = String(library[key].length);
    });
    const items = library[activeCollection] || [];
    const list = $("library-list");
    const sectionCopy = activeCollection === "favorites"
      ? ["LIKES", "Your favorites.", "Titles you have saved to your library."]
      : activeCollection === "watchLater"
        ? ["WATCH LATER", "Your watchlist.", "Keep the titles you want to come back to."]
        : ["HISTORY", "Recently watched.", "Your latest Vivid Cinema activity."];

    if (!items.length) {
      const copy = activeCollection === "favorites"
        ? ["No likes yet","Like titles from their detail page and they will appear here.","Discover titles","bi-heart"]
        : activeCollection === "watchLater"
          ? ["Your watch-later list is empty","Save something you want to come back to.","Browse movies & TV","bi-clock"]
          : ["No recent history","Titles you open will appear here for quick access.","Start browsing","bi-play-circle"];
      list.innerHTML = '<div class="vivid-library-shelf-head"><div><span class="vivid-library-kicker">'+sectionCopy[0]+'</span><h2>'+sectionCopy[1]+'</h2><p>'+sectionCopy[2]+'</p></div></div><div class="vivid-library-empty"><i class="bi '+copy[3]+'"></i><h2>'+copy[0]+'</h2><p>'+copy[1]+'</p><a class="vivid-button vivid-button--primary" href="discover.html">'+copy[2]+'</a></div>';
      return;
    }
    list.innerHTML = '<div class="vivid-library-shelf-head"><div><span class="vivid-library-kicker">'+sectionCopy[0]+'</span><h2>'+sectionCopy[1]+'</h2><p>'+sectionCopy[2]+'</p></div><span class="vivid-library-shelf-note">'+items.length+' saved</span></div><div class="vivid-library-shelf">'+items.map((item) => {
      const type=item.media_type||item.mediaType||"movie", url=getMediaUrl({id:item.id,media_type:type}), title=item.title||item.name||"Untitled";
      const meta=[type==="tv"?"TV":"Movie",item.year||""].filter(Boolean).join(" · ");
      return '<article class="vivid-library-card vivid-card--poster"><a href="'+escapeHtml(url)+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(title)+' poster"><div class="vivid-library-card-copy"><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(meta)+'</small></div></a><button class="vivid-library-remove" type="button" data-remove-id="'+escapeHtml(String(item.id))+'" data-remove-type="'+escapeHtml(type)+'" aria-label="Remove '+escapeHtml(title)+'"><i class="bi bi-x-lg"></i></button></article>';
    }).join("") + '</div>';
    list.querySelectorAll("[data-remove-id]").forEach((button) => button.addEventListener("click",(event)=>{
      event.preventDefault(); event.stopPropagation(); removeLibraryItem(activeCollection,button.dataset.removeId,button.dataset.removeType); void render();
    }));
  } catch (error) {
    if (revision !== renderRevision) return;
    console.warn("Vivid library viewing limits could not be verified:", error);
    renderContinueWatching([]);
    ["favorites","watchLater","history"].forEach(key => {
      const count = document.querySelector("[data-count=\"" + key + "\"]");
      if (count) count.textContent = "0";
    });
    const list = $("library-list");
    list.innerHTML = '<div class="vivid-library-empty"><i class="bi bi-shield-lock"></i><h2>Viewing settings unavailable</h2><p>We could not verify this profile’s viewing limits. Try again before opening saved titles.</p><button class="vivid-button vivid-button--primary" type="button" id="library-retry">Try again</button></div>';
    $("library-retry")?.addEventListener("click", () => void render());
  }
}

document.addEventListener("DOMContentLoaded",()=>{
  const syncStatus=document.getElementById("library-sync-status");
  const syncDot=document.getElementById("library-sync-dot");
  const setSync=(message,state)=>{if(syncStatus)syncStatus.textContent=message;if(syncDot)syncDot.dataset.state=state;};

  // Paint device-saved titles immediately; never hold the library UI behind a
  // Firebase Auth/Firestore round trip.
  void render();
  setSync("Showing saved titles · checking cloud sync…","syncing");

  // Re-render when local changes or the remote merge updates the local snapshot.
  window.addEventListener("vivid:library-changed",()=>{ void render(); });

  document.querySelectorAll("[data-library-tab]").forEach((tab)=>tab.addEventListener("click",()=>{
    activeCollection=tab.dataset.libraryTab;
    document.querySelectorAll("[data-library-tab]").forEach((item)=>{const active=item===tab;item.classList.toggle("is-active",active);item.setAttribute("aria-selected",String(active));});
    void render();
  }));
  $("library-clear")?.addEventListener("click",()=>{
    if(getLocalLibrary()[activeCollection]?.length&&window.confirm("Clear this library list on this device?")){clearLibraryCollection(activeCollection);void render();}
  });

  void startLibrarySync().then(()=>{
    void render();
    setSync("Library is up to date.","success");
  }).catch(()=>{
    setSync("Showing device-saved titles · cloud sync unavailable.","error");
  });
});