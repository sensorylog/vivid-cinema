import { tmdbApi } from "./scripts/tmdb.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./scripts/media.js";
import { escapeHtml } from "./scripts/utils.js";

const container=document.getElementById("watch-container");
const params=new URLSearchParams(location.search);
const contentId=params.get("id");
const requestedType=params.get("type")==="tv"?"tv":params.get("type")==="movie"?"movie":null;
let moreLikePage=1,currentContent=null,currentType=requestedType||"movie";

function storeList(key,content){
  const list=JSON.parse(localStorage.getItem(key)||"[]");
  const normalized={id:String(content.id),title:content.title||content.name,poster_path:content.poster_path,media_type:content.media_type||currentType,content_id:(content.media_type||currentType)+":"+content.id};
  if(!list.some(item=>item.content_id===normalized.content_id)){list.push(normalized);localStorage.setItem(key,JSON.stringify(list));return true;}
  return false;
}
function renderCast(cast=[]){return `<div class="cast-list">${cast.slice(0,10).map(a=>`<div class="cast-member"><img loading="lazy" src="${getImageUrl(a.profile_path)}" alt="${escapeHtml(a.name)}"><p>${escapeHtml(a.name)}</p></div>`).join("")}</div>`;}
function renderSimilar(results=[]){return normalizeResults(results,currentType).slice(0,6).map(item=>`<div class="movie-box" data-id="${escapeHtml(item.id)}" data-type="${item.media_type}"><img loading="lazy" src="${getImageUrl(item.poster_path)}" alt="${escapeHtml(item.title)}"><div class="box-text"><p>${escapeHtml(item.title)}</p></div></div>`).join("");}
function bindSimilar(){document.querySelectorAll("#similar-container .movie-box").forEach(card=>{card.addEventListener("click",()=>{location.href=getMediaUrl({id:card.dataset.id,media_type:card.dataset.type});});});}
function commentsFor(id){try{return JSON.parse(localStorage.getItem("comments")||"{}")[id]||[];}catch{return [];}}
function renderComments(id){const box=document.getElementById("comments-container");if(!box)return;const comments=commentsFor(id);box.innerHTML=comments.length?comments.map(c=>`<div class="comment"><p><strong>${escapeHtml(c.username)}</strong></p><p>${escapeHtml(c.comment)}</p></div>`).join(""):'<p class="empty-state">No comments yet.</p>';}
function bindComments(id){const form=document.getElementById("comment-form");if(!form)return;form.addEventListener("submit",e=>{e.preventDefault();const username=form.querySelector("[name=username]").value.trim(),comment=form.querySelector("[name=comment]").value.trim();if(!username||!comment)return;const all=JSON.parse(localStorage.getItem("comments")||"{}");all[id]=all[id]||[];all[id].push({username,comment,createdAt:Date.now()});localStorage.setItem("comments",JSON.stringify(all));form.reset();renderComments(id);});}
async function commonDetails(type,id){const data=type==="tv"?await tmdbApi.tvDetails(id):await tmdbApi.movieDetails(id);return {details:data,videos:data.videos||{results:[]},credits:data.credits||{cast:[]},similar:data.similar||{results:[]}};}
function trailerMarkup(videos){const trailer=(videos.results||[]).find(v=>v.type==="Trailer"&&v.site==="YouTube");return trailer?`<iframe title="Trailer" width="100%" height="400" src="https://www.youtube.com/embed/${encodeURIComponent(trailer.key)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`:"<p>No trailer available.</p>";}
async function render(type,id){
  currentType=type;const {details,videos,credits,similar}=await commonDetails(type,id);currentContent={...details,media_type:type};
  const title=type==="tv"?details.name:details.title, date=type==="tv"?details.first_air_date:details.release_date;
  const seasons=type==="tv"?(details.seasons||[]).filter(s=>s.season_number>0):[];
  container.innerHTML=`<a href="home.html" class="watch-btn">← Back to Home</a><div class="movie-detail">
    <h1 class="movie-title">${escapeHtml(title)}</h1><p class="movie-meta">${escapeHtml(date||"Release date unavailable")} · ${type==="movie"?(details.runtime||"?")+" min · ":""}${escapeHtml((details.genres||[]).map(g=>g.name).join(", "))}</p>
    <p class="movie-description">${escapeHtml(details.overview||"No description available.")}</p><h3>Trailer</h3><div class="video-frame">${trailerMarkup(videos)}</div>
    <h3>Cast</h3>${renderCast(credits.cast)}${type==="tv"?`<h3>Seasons</h3><select id="season-selector">${seasons.map(s=>`<option value="${s.season_number}">${escapeHtml(s.name)} (Season ${s.season_number})</option>`).join("")}</select>`:""}
    <h3>More Like This</h3><div class="movies-content" id="similar-container">${renderSimilar(similar.results)}</div><button class="watch-btn" id="load-more">Load More</button>
    <div class="btn-row"><button class="watch-btn" id="add-watch-later">Add to Watch Later</button><button class="watch-btn" id="add-favorites">Add to Favorites</button></div>
    <div class="comment-section"><h3>User Comments</h3><div id="comments-container"></div><form id="comment-form"><input name="username" type="text" placeholder="Your Name" maxlength="80" required><textarea name="comment" placeholder="Add your comment..." maxlength="1000" required></textarea><button type="submit" class="watch-btn">Post Comment</button></form></div></div>`;
  bindPage(details.id);
}
function bindPage(id){
  bindSimilar();renderComments(id);bindComments(id);
  document.getElementById("load-more")?.addEventListener("click",async()=>{moreLikePage++;try{const data=await tmdbApi[currentType==="tv"?"tvSimilar":"movieSimilar"](id,moreLikePage);const results=data.results||[];const box=document.getElementById("similar-container");if(box)box.insertAdjacentHTML("beforeend",renderSimilar(results));bindSimilar();}catch(e){console.error(e);}});
  document.getElementById("add-watch-later")?.addEventListener("click",()=>alert(storeList("watchLater",currentContent)?"Added to Watch Later.":"Already in Watch Later."));
  document.getElementById("add-favorites")?.addEventListener("click",()=>alert(storeList("favorites",currentContent)?"Added to Favorites.":"Already in Favorites."));
}
if(container){if(contentId){if(requestedType){render(requestedType,contentId).catch(e=>{console.error(e);container.innerHTML="<p>Unable to load this title right now.</p>";});}else{Promise.all([tmdbApi.movieDetails(contentId),tmdbApi.tvDetails(contentId)]).then(([movie,tv])=>{if(movie?.id&&movie.title)return render("movie",contentId);if(tv?.id&&tv.name)return render("tv",contentId);throw new Error("Content not found");}).catch(e=>{console.error(e);container.innerHTML="<p>Unable to load this title right now.</p>";});}}else container.innerHTML="<p>No content selected.</p>";}
