import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

const ANIMATION_GENRE = "16";
const GENRES = Object.freeze({
  action: { movie: "28", tv: "10759" }, adventure: { movie: "12", tv: "10759" },
  comedy: { movie: "35", tv: "35" }, drama: { movie: "18", tv: "18" },
  fantasy: { movie: "14", tv: "10765" }, horror: { movie: "27", tv: "27" },
  mystery: { movie: "9648", tv: "9648" }, romance: { movie: "10749", tv: "10749" },
  scifi: { movie: "878", tv: "10765" }
});
function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
}
function dateWindow(shelf) {
  const today=new Date(), start=new Date(today), end=new Date(today);
  if(shelf==="upcoming"){end.setDate(end.getDate()+120);start.setDate(start.getDate()+1);}
  else if(shelf==="airing") start.setDate(start.getDate()-30);
  else if(shelf==="seasonal"){const q=Math.floor(today.getMonth()/3)*3;start.setMonth(q,1);end.setMonth(q+3,0);}
  return {from:dateKey(start),to:dateKey(end)};
}
function buildParams(mediaType,page,filters) {
  const params={page,with_genres:ANIMATION_GENRE,with_original_language:"ja",sort_by:filters.sort_by||"popularity.desc",include_adult:false};
  const genre=GENRES[filters.genre];
  if(genre)params.with_genres+=","+genre[mediaType];
  if(filters.year){if(mediaType==="tv")params.first_air_date_year=filters.year;else params.primary_release_year=filters.year;}
  if(filters.rating){params["vote_average.gte"]=filters.rating;params["vote_count.gte"]="20";}
  if(filters.query)params.with_text_query=filters.query;
  if(filters.sort_by==="vote_average.desc")params["vote_count.gte"]="100";
  if(["upcoming","airing","seasonal"].includes(filters.shelf)){
    const {from,to}=dateWindow(filters.shelf);
    if(mediaType==="tv"){params["first_air_date.gte"]=from;params["first_air_date.lte"]=to;params.sort_by=filters.shelf==="upcoming"?"first_air_date.asc":"popularity.desc";}
    else{params["primary_release_date.gte"]=from;params["primary_release_date.lte"]=to;params.sort_by=filters.shelf==="upcoming"?"primary_release_date.asc":"popularity.desc";}
  }
  return params;
}
export async function getAnimePage(page=1,filters={}) {
  const safePage=Math.max(1,Math.min(500,Math.trunc(Number(page)||1)));
  const type=filters.type==="movie"||filters.type==="tv"?filters.type:"";
  const types=type?[type]:["tv","movie"];
  const requests=types.map(mediaType=>(mediaType==="movie"?tmdbApi.discoverMovies(buildParams(mediaType,safePage,filters)):tmdbApi.discoverTv(buildParams(mediaType,safePage,filters))).then(data=>({data,mediaType})));
  const results=await Promise.allSettled(requests);
  const successful=results.filter(r=>r.status==="fulfilled").map(r=>r.value);
  if(!successful.length)throw results.find(r=>r.status==="rejected")?.reason||new Error("Anime catalogue unavailable.");
  const items=successful.flatMap(({data,mediaType})=>normalizeResults(data?.results||[],mediaType)).filter(item=>item?.id).sort((a,b)=>{
    const da=String(a.date||""),db=String(b.date||"");
    if(filters.shelf==="upcoming")return da.localeCompare(db);
    if(filters.sort_by==="vote_average.desc")return Number(b.vote_average||0)-Number(a.vote_average||0)||Number(b.raw?.popularity||0)-Number(a.raw?.popularity||0);
    if(filters.sort_by==="first_air_date.desc")return db.localeCompare(da);
    return Number(b.raw?.popularity||0)-Number(a.raw?.popularity||0)||Number(b.vote_average||0)-Number(a.vote_average||0);
  });
  return {items,page:safePage,totalPages:Math.min(500,Math.max(...successful.map(({data})=>Number(data?.total_pages||1)),1)),partial:successful.length<requests.length};
}
export const ANIME_DISCOVERY_GENRES=Object.freeze(Object.keys(GENRES));
