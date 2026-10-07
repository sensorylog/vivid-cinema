import { getAnimePage } from "./content.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

const grid=document.getElementById("anime-grid");
const status=document.getElementById("anime-status");
const more=document.getElementById("anime-load-more");
let page=1,totalPages=1;
let filters={type:"",sort_by:"popularity.desc"};
let loading=false;

function card(item){
  const type=item.media_type==="tv"?"SERIES":"FILM";
  return '<a class="vivid-anime-card" href="'+escapeHtml(getMediaUrl(item))+'"><div class="vivid-anime-poster"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title)+'"><span>'+type+'</span><b>★ '+(item.vote_average?item.vote_average.toFixed(1):"—")+'</b></div><div class="vivid-anime-card-copy"><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.year||"")+'</small></div></a>';
}
function paint(items,append=false){
  if(!append)grid.innerHTML="";
  const html=items.map(card).join("");
  if(append)grid.insertAdjacentHTML("beforeend",html); else grid.innerHTML=html||'<div class="vivid-anime-empty">No anime matched this view.</div>';
}
async function load(reset=false){
  if(loading)return;
  loading=true; more.disabled=true; more.textContent="Loading…";
  const target=reset?1:page+1;
  try{
    const result=await getAnimePage(target,filters);
    if(reset){page=1;paint(result.items,false)}else{page=target;paint(result.items,true)}
    totalPages=result.totalPages;
    status.textContent=(filters.type==="tv"?"Anime series":filters.type==="movie"?"Anime films":"All anime")+" · "+(page<totalPages?"More ready to explore.":"End of this collection.");
    more.hidden=page>=totalPages;
  }catch(error){
    if(reset)grid.innerHTML='<div class="vivid-anime-empty">Anime is temporarily unavailable. Try again.</div>';
    status.textContent="Anime catalogue unavailable.";
  }finally{loading=false;more.disabled=false;more.textContent="Load more"}
}
document.querySelectorAll("[data-anime-type]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-anime-type]").forEach(x=>x.classList.toggle("is-active",x===btn));
  filters.type=btn.dataset.animeType||"";void load(true);
}));
document.querySelectorAll("[data-anime-sort]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-anime-sort]").forEach(x=>x.classList.toggle("is-active",x===btn));
  filters.sort_by=btn.dataset.animeSort;void load(true);
}));
more.addEventListener("click",()=>void load(false));
load(true);