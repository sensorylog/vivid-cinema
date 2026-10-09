import { getAnimePage } from "./content.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

const grid=document.getElementById("anime-grid");
const status=document.getElementById("anime-status");
const more=document.getElementById("anime-load-more");
let page=1,totalPages=1,filters={type:"",sort_by:"popularity.desc"},requestToken=0;
const seen=new Set();

function card(item){
  const key=String(item.media_type||"tv")+":"+String(item.id);
  const type=item.media_type==="tv"?"SERIES":"FILM";
  return '<a class="vivid-anime-card" data-anime-key="'+escapeHtml(key)+'" href="'+escapeHtml(getMediaUrl(item)+"&anime=1")+'"><div class="vivid-anime-poster"><img loading="lazy" decoding="async" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title||"Anime title")+'"><span>'+type+'</span><b>★ '+(item.vote_average?Number(item.vote_average).toFixed(1):"—")+'</b></div><div class="vivid-anime-card-copy"><strong>'+escapeHtml(item.title||"Untitled")+'</strong><small>'+escapeHtml(item.year||"")+'</small></div></a>';
}
function paint(items,append=false){
  if(!append){grid.innerHTML="";seen.clear();}
  const unique=[];
  for(const item of items||[]){
    const key=String(item.media_type||"tv")+":"+String(item.id||"");
    if(!item?.id||seen.has(key))continue;
    seen.add(key);unique.push(item);
  }
  const html=unique.map(card).join("");
  if(append)grid.insertAdjacentHTML("beforeend",html);
  else grid.innerHTML=html||'<div class="vivid-anime-empty">No anime matched this view.</div>';
}
async function load(reset=false){
  const token=++requestToken;
  const target=reset?1:page+1;
  if(!reset&&page>=totalPages)return;
  more.disabled=true;more.textContent="Loading…";
  if(reset){page=1;seen.clear();grid.setAttribute("aria-busy","true");}
  if(status)status.textContent="Loading anime catalogue…";
  try{
    const result=await getAnimePage(target,{...filters});
    if(token!==requestToken)return;
    if(reset){page=1;paint(result.items,false)}else{page=target;paint(result.items,true)}
    totalPages=Math.max(1,Number(result.totalPages)||1);
    status.textContent=(filters.type==="tv"?"Anime series":filters.type==="movie"?"Anime films":"All anime")+" · "+(page<totalPages?"More ready to explore.":"End of this collection.")+(result.partial?" Some catalogue sources did not respond.":"");
    more.hidden=page>=totalPages;
  }catch(error){
    if(token!==requestToken)return;
    if(reset)grid.innerHTML='<div class="vivid-anime-empty">Anime is temporarily unavailable. <button type="button" data-anime-retry>Try again</button></div>';
    status.textContent="Anime catalogue unavailable.";
  }finally{
    if(token===requestToken){more.disabled=false;more.textContent="Load more";grid.removeAttribute("aria-busy");}
  }
}
document.querySelectorAll("[data-anime-type]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-anime-type]").forEach(x=>{x.classList.toggle("is-active",x===btn);x.setAttribute("aria-pressed",x===btn?"true":"false");});
  filters.type=btn.dataset.animeType||"";void load(true);
}));
document.querySelectorAll("[data-anime-sort]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-anime-sort]").forEach(x=>{x.classList.toggle("is-active",x===btn);x.setAttribute("aria-pressed",x===btn?"true":"false");});
  filters.sort_by=btn.dataset.animeSort;void load(true);
}));
more.addEventListener("click",()=>void load(false));
grid?.addEventListener("click",event=>{if(event.target.closest("[data-anime-retry]"))void load(true);});
document.querySelectorAll("[data-anime-type],[data-anime-sort]").forEach(btn=>btn.setAttribute("aria-pressed",btn.classList.contains("is-active")?"true":"false"));
load(true);
