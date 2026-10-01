import { tmdbApi } from "./tmdb.js";
import { getHomeSectionPage, HOME_SECTION_META } from "./content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
import { getRoute, buildDiscoverUrl } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
const COLLECTIONS = {
  trending: { key: "trending", label: "Trending now", description: "The titles people are discovering this week." },
  nowPlaying: { key: "nowPlaying", label: "Now playing", description: "Movies in the current release cycle." },
  popularMovies: { key: "popularMovies", label: "Popular movies", description: "Big-screen stories getting the most attention." },
  topRatedMovies: { key: "topRatedMovies", label: "Top rated movies", description: "Movies with strong audience ratings." },
  popularTv: { key: "popularTv", label: "Popular TV", description: "Series people are watching now." },
  topRatedTv: { key: "topRatedTv", label: "Top rated TV", description: "Highly rated series across the catalogue." },
  airingToday: { key: "airingToday", label: "On TV today", description: "Series with episodes airing today." },
  anime: { key: "anime", label: "Anime", description: "Animated worlds and stories." },
  kdrama: { key: "kdrama", label: "K-Dramas", description: "Popular Korean series." },
  upcoming: { key: "upcoming", label: "Coming soon", description: "Upcoming movies on the radar." },
  movies: { key: "popularMovies", label: "Movies", description: "Browse the movie catalogue." },
  tv: { key: "popularTv", label: "TV series", description: "Browse the TV catalogue." }
};
let genres={movie:[],tv:[]};
let state={collection:"trending",page:0,totalPages:1,items:[],requestId:0,genre:"",year:"",sort:"popularity.desc"};

function currentType(){return HOME_SECTION_META[COLLECTIONS[state.collection]?.key]?.type || "all";}
function currentGenres(){
  const type=currentType();
  if(type==="movie")return genres.movie;
  if(type==="tv")return genres.tv;
  return [...genres.movie,...genres.tv].filter((g,i,a)=>a.findIndex(x=>x.id===g.id)===i).sort((a,b)=>a.name.localeCompare(b.name));
}
function populateYears(){
  const now=new Date().getFullYear();
  $("collection-year").innerHTML='<option value="">Any year</option>'+Array.from({length:76},(_,i)=>now-i).map(y=>'<option value="'+y+'">'+y+'</option>').join("");
}
function populateGenres(){
  const list=currentGenres();
  $("collection-genre").innerHTML='<option value="">All genres</option>'+list.map(g=>'<option value="'+g.id+'">'+escapeHtml(g.name)+'</option>').join("");
  $("collection-genre").value=state.genre;
}
function card(item){
  return '<a class="vivid-discovery-card" href="'+escapeHtml(getMediaUrl(item))+'"><div class="vivid-discovery-poster"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w500")+'" alt="'+escapeHtml(item.title)+' poster" onerror="this.style.visibility=\'hidden\'"><span class="vivid-discovery-rating">★ '+(item.vote_average?item.vote_average.toFixed(1):"—")+'</span></div><div class="vivid-discovery-copy"><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.year||"—")+' · '+(item.media_type==="tv"?"TV":"Movie")+'</small></div></a>';
}
function sort(items){
  const date=x=>Date.parse(x.date||"")||0;
  if(state.sort==="vote_average.desc")return items.sort((a,b)=>Number(b.vote_average||0)-Number(a.vote_average||0));
  if(state.sort==="primary_release_date.asc")return items.sort((a,b)=>date(a)-date(b));
  if(state.sort==="primary_release_date.desc")return items.sort((a,b)=>date(b)-date(a));
  return items;
}
async function loadGenres(){
  const [movie,tv]=await Promise.allSettled([tmdbApi.movieGenres(),tmdbApi.tvGenres()]);
  genres.movie=movie.status==="fulfilled"?(movie.value.genres||[]):[];
  genres.tv=tv.status==="fulfilled"?(tv.value.genres||[]):[];
  populateGenres();
}
async function loadPage(reset=false){
  const id=++state.requestId;
  if(reset){state.page=0;state.items=[];$("collection-grid").innerHTML="";}
  $("collection-more").disabled=true;
  $("collection-status").textContent=state.page?"Loading more…":"Loading titles…";
  try{
    let data;
    const type=currentType();
    const hasFilters=state.genre||state.year||state.sort!=="popularity.desc";
    if(!hasFilters){
      data=await getHomeSectionPage(COLLECTIONS[state.collection].key,state.page+1);
    }else{
      const page=state.page+1;
      const params={page,sort_by:state.sort,with_genres:state.genre||undefined};
      if(type==="movie")params.primary_release_year=state.year||undefined;
      else if(type==="tv")params.first_air_date_year=state.year||undefined;
      else return;
      const raw=type==="movie"?await tmdbApi.discoverMovies(params):await tmdbApi.discoverTv({...params,sort_by:state.sort.replace("primary_release_date","first_air_date")});
      data={items:normalizeResults(raw.results||[],type),page:Number(raw.page||page),totalPages:Number(raw.total_pages||1)};
    }
    if(id!==state.requestId)return;
    let incoming=sort(data.items||[]);
    if(reset)state.items=incoming;else state.items=[...state.items,...incoming.filter(item=>!state.items.some(x=>x.content_id===item.content_id))];
    state.page=data.page;state.totalPages=data.totalPages;
    $("collection-grid").innerHTML=state.items.map(card).join("");
    $("collection-empty").hidden=state.items.length>0;
    $("collection-more").hidden=state.page>=state.totalPages||!state.items.length;
    $("collection-status").textContent=state.items.length+" titles";
  }catch(error){
    if(id!==state.requestId)return;
    if(!state.items.length)$("collection-grid").innerHTML='<div class="vivid-discovery-error"><i class="bi bi-exclamation-circle"></i><h2>Collection unavailable</h2><p>'+escapeHtml(getErrorMessage(error))+'</p></div>';
    $("collection-more").hidden=true;
    $("collection-status").textContent="";
  }finally{$("collection-more").disabled=false;}
}
function apply(){
  state.genre=$("collection-genre").value;state.year=$("collection-year").value;state.sort=$("collection-sort").value;loadPage(true);
}
function wire(){
  $("collection-more").addEventListener("click",()=>loadPage(false));
  ["collection-genre","collection-year","collection-sort"].forEach(id=>$(id).addEventListener("change",apply));
  $("collection-reset").addEventListener("click",()=>{$("collection-genre").value="";$("collection-year").value="";$("collection-sort").value="popularity.desc";state.genre="";state.year="";state.sort="popularity.desc";loadPage(true);});
}
async function init(){
  const requested=route.params.get("collection")||"trending";
  state.collection=COLLECTIONS[requested]?requested:"trending";
  const meta=COLLECTIONS[state.collection];
  $("collection-kicker").textContent="COLLECTION";
  $("collection-title").textContent=meta.label;
  $("collection-description").textContent=meta.description;
  document.title=meta.label+" · Vivid Cinema";
  populateYears();wire();await loadGenres();await loadPage(true);
}
init();
