import { tmdbApi } from "./scripts/tmdb.js";
import { searchContent, discoverMovies } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./scripts/media.js";
import { escapeHtml, debounce } from "./scripts/utils.js";

const $ = (id) => document.getElementById(id);
const popularContainer=$("popular-container"), moviesContainer=$("movies-container"),
topRatedContainer=$("top-rated-container"), animeContainer=$("Anime"),
kdramaContainer=$("kdrama-container"), tvshowsContainer=$("tvshows-container"),
upcomingSlider=$("upcoming-cards"), searchInput=$("search-input"),
toggleThemeBtn=$("theme-toggle"), nextBtn=$("nowplaying-more"),
heroTitle=$("title"), heroDesc=$("overview"), heroGenre=$("gen"),
heroDate=$("date"), heroRating=$("rating"), heroVideoContainer=$("hero-video-container");

let allMovies=[], allMoviesPage=1, popularPage=1, topRatedPage=1, animePage=1,
kdramaPage=1, tvPage=1, upcomingMovies=[], currentTrailerIndex=0;

function movieCard(media){
  const title=media.title||"Untitled";
  return `<div class="movie-box" data-id="${escapeHtml(media.id)}" data-type="${media.media_type}" role="button" tabindex="0">
    <img src="${getImageUrl(media.poster_path)}" alt="${escapeHtml(title)}" class="movie-box-img" loading="lazy">
    <div class="box-text"><h2 class="movie-title">${escapeHtml(title)}</h2><span class="movie-type">${escapeHtml(media.year||"N/A")}</span></div>
  </div>`;
}
function renderCards(container,results,append=false){
  if(!container)return;
  if(!append)container.innerHTML="";
  if(!results?.length&&!append){container.innerHTML='<p class="empty-state">No results found.</p>';return;}
  const normalized=results.map(item=>item.media_type?item:normalizeResults([item])[0]).filter(Boolean);
  container.insertAdjacentHTML("beforeend",normalized.map(movieCard).join(""));
  container.querySelectorAll(".movie-box").forEach(card=>{
    if(card.dataset.bound)return;
    card.dataset.bound="1";
    const open=()=>{window.location.href=getMediaUrl({id:card.dataset.id,media_type:card.dataset.type});};
    card.addEventListener("click",open);
    card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
  });
}
function renderAllMovies(movies){allMovies=movies||[];window.allMovies=allMovies;renderCards(moviesContainer,allMovies);}
window.renderAllMovies=renderAllMovies; window.allMovies=allMovies;

async function fetchAllMovies(page=1,append=false){
  try{const data=await tmdbApi.popularMovies(page);allMovies=append?[...allMovies,...normalizeResults(data.results||[],"movie")]:normalizeResults(data.results||[],"movie");window.allMovies=allMovies;renderCards(moviesContainer,data.results||[],append);}
  catch(error){console.error(error);if(!append&&moviesContainer)moviesContainer.innerHTML='<p class="empty-state">Movies could not be loaded. Please try again.</p>';}
}
async function loadSection(container,loader,append=false){
  try{renderCards(container,await loader(),append);}
  catch(error){console.error(error);if(!append&&container)container.innerHTML='<p class="empty-state">This section could not be loaded.</p>';}
}
async function search(query){
  try{renderAllMovies(await searchContent(query));}
  catch(error){console.error(error);if(moviesContainer)moviesContainer.innerHTML='<p class="empty-state">Search failed. Please try again.</p>';}
}
const runSearch=debounce(()=>{const q=searchInput?.value.trim();q?search(q):fetchAllMovies();},350);
searchInput?.addEventListener("input",runSearch);
nextBtn?.addEventListener("click",()=>{allMoviesPage++;fetchAllMovies(allMoviesPage,true);});

async function fetchUpcomingMovies(){
  if(!upcomingSlider)return;
  try{
    upcomingMovies=(await tmdbApi.upcomingMovies()).results||[];
    upcomingMovies=normalizeResults(upcomingMovies,"movie").slice(0,10);
    upcomingSlider.innerHTML=upcomingMovies.map((m,i)=>`<div class="card" data-id="${escapeHtml(m.id)}" data-index="${i}">
      <img src="${getImageUrl(m.poster_path)}" alt="${escapeHtml(m.title)}" class="poster" loading="lazy">
      <div class="cont"><h4>${escapeHtml(m.title)}</h4><div class="sub"><span>${escapeHtml(m.year||"N/A")}</span><span>★ ${m.vote_average.toFixed(1)}</span></div></div></div>`).join("");
    upcomingSlider.querySelectorAll(".card").forEach(card=>card.addEventListener("click",()=>{currentTrailerIndex=Number(card.dataset.index);loadHeroTrailer(upcomingMovies[currentTrailerIndex]);}));
    if(upcomingMovies[0])loadHeroTrailer(upcomingMovies[0]);
  }catch(error){console.error(error);}
}
async function loadHeroTrailer(movie){
  if(!movie)return;
  if(heroTitle)heroTitle.textContent=movie.title;if(heroDesc)heroDesc.textContent=movie.overview||"No description available.";
  if(heroDate)heroDate.textContent=movie.year||"N/A";if(heroRating)heroRating.textContent=movie.vote_average.toFixed(1);if(heroGenre)heroGenre.textContent="Featured";
  if(!heroVideoContainer)return;
  try{
    const data=await tmdbApi.movieDetails(movie.id);
    const trailer=(data.videos?.results||[]).find(v=>v.type==="Trailer"&&v.site==="YouTube");
    heroVideoContainer.innerHTML=trailer?`<iframe title="Trailer for ${escapeHtml(movie.title)}" src="https://www.youtube.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(trailer.key)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`:"";
  }catch(error){console.error(error);heroVideoContainer.innerHTML="";}
}
window.scrollCards=(direction)=>{if(!upcomingMovies.length)return;currentTrailerIndex=(currentTrailerIndex+direction+upcomingMovies.length)%upcomingMovies.length;loadHeroTrailer(upcomingMovies[currentTrailerIndex]);};

function loadTheme(){document.body.classList.toggle("light-theme",localStorage.getItem("theme")==="light");}
function toggleTheme(){const light=!document.body.classList.contains("light-theme");document.body.classList.toggle("light-theme",light);localStorage.setItem("theme",light?"light":"dark");}
toggleThemeBtn?.addEventListener("click",toggleTheme);

document.addEventListener("DOMContentLoaded",()=>{
  loadTheme();fetchAllMovies();
  loadSection(popularContainer,()=>tmdbApi.popularMovies().then(d=>normalizeResults(d.results||[],"movie")));
  loadSection(topRatedContainer,()=>tmdbApi.topRatedMovies().then(d=>normalizeResults(d.results||[],"movie")));
  loadSection(animeContainer,()=>discoverMovies({with_genres:16,sort_by:"popularity.desc"}));
  loadSection(kdramaContainer,()=>tmdbApi.discoverTv({with_original_language:"ko",sort_by:"popularity.desc"}).then(d=>normalizeResults(d.results||[],"tv")));
  loadSection(tvshowsContainer,()=>tmdbApi.popularTv().then(d=>normalizeResults(d.results||[],"tv")));
  fetchUpcomingMovies();
  $("popular-more")?.addEventListener("click",()=>{popularPage++;loadSection(popularContainer,()=>tmdbApi.popularMovies(popularPage).then(d=>normalizeResults(d.results||[],"movie")),true);});
  $("top-rated-more")?.addEventListener("click",()=>{topRatedPage++;loadSection(topRatedContainer,()=>tmdbApi.topRatedMovies(topRatedPage).then(d=>normalizeResults(d.results||[],"movie")),true);});
  $("Anime-more")?.addEventListener("click",()=>{animePage++;loadSection(animeContainer,()=>discoverMovies({page:animePage,with_genres:16,sort_by:"popularity.desc"}),true);});
  $("kdrama-more")?.addEventListener("click",()=>{kdramaPage++;loadSection(kdramaContainer,()=>tmdbApi.discoverTv({page:kdramaPage,with_original_language:"ko",sort_by:"popularity.desc"}).then(d=>normalizeResults(d.results||[],"tv")),true);});
  $("tvshows-more")?.addEventListener("click",()=>{tvPage++;loadSection(tvshowsContainer,()=>tmdbApi.popularTv(tvPage).then(d=>normalizeResults(d.results||[],"tv")),true);});
});
