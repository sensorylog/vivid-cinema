import { getLocalLibrary, clearLibraryCollection, removeLibraryItem } from "./library.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

let activeCollection = "favorites";
const $ = (id) => document.getElementById(id);

function render() {
  const library = getLocalLibrary();
  ["favorites","watchLater","history"].forEach((key) => {
    const count = document.querySelector("[data-count="" + key + ""]");
    if (count) count.textContent = String((library[key] || []).length);
  });
  const items = library[activeCollection] || [];
  const list = $("library-list");
  if (!items.length) {
    const copy = activeCollection === "favorites"
      ? ["No favorites yet","Save titles from their detail page and they will appear here.","Discover titles"]
      : activeCollection === "watchLater"
        ? ["Your watch-later list is empty","Save something you want to come back to.","Browse movies & TV"]
        : ["No recent history","Titles you open will appear here for quick access.","Start browsing"];
    list.innerHTML = '<div class="vivid-library-empty"><i class="bi bi-bookmark"></i><h2>'+copy[0]+'</h2><p>'+copy[1]+'</p><a class="vivid-button vivid-button--primary" href="discover.html">'+copy[2]+'</a></div>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const type=item.media_type||item.mediaType||"movie", url=getMediaUrl({id:item.id,media_type:type}), title=item.title||item.name||"Untitled";
    const meta=[type==="tv"?"TV":"Movie",item.year||""].filter(Boolean).join(" · ");
    return '<a class="vivid-library-card" href="'+escapeHtml(url)+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(title)+' poster"><div class="vivid-library-card-copy"><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(meta)+'</small></div><button class="vivid-library-remove" type="button" data-remove-id="'+escapeHtml(String(item.id))+'" data-remove-type="'+escapeHtml(type)+'" aria-label="Remove '+escapeHtml(title)+'"><i class="bi bi-x-lg"></i></button></a>';
  }).join("");
  list.querySelectorAll("[data-remove-id]").forEach((button) => button.addEventListener("click",(event)=>{
    event.preventDefault(); event.stopPropagation(); removeLibraryItem(activeCollection,button.dataset.removeId,button.dataset.removeType); render();
  }));
}

document.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll("[data-library-tab]").forEach((tab)=>tab.addEventListener("click",()=>{
    activeCollection=tab.dataset.libraryTab;
    document.querySelectorAll("[data-library-tab]").forEach((item)=>{const active=item===tab;item.classList.toggle("is-active",active);item.setAttribute("aria-selected",String(active));});
    render();
  }));
  $("library-clear")?.addEventListener("click",()=>{
    if(getLocalLibrary()[activeCollection]?.length&&window.confirm("Clear this library list on this device?")){clearLibraryCollection(activeCollection);render();}
  });
  render();
});