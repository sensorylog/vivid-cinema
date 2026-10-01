import { tmdbApi } from "./scripts/tmdb.js";
import { discoverMovies } from "./scripts/content.js";

(() => {
  const genreSelect=document.getElementById("genre-select"), yearSelect=document.getElementById("year-select"),
    applyBtn=document.getElementById("apply-filters"), hamburgerBtn=document.getElementById("hamburger-btn"),
    mobileMenu=document.getElementById("mobile-filter-menu"), closeBtn=document.getElementById("close-filter-menu");
  if(!genreSelect||!yearSelect||!applyBtn||!hamburgerBtn||!mobileMenu||!closeBtn)return;

  hamburgerBtn.addEventListener("click",()=>{const open=hamburgerBtn.classList.toggle("open");mobileMenu.classList.toggle("open",open);hamburgerBtn.setAttribute("aria-expanded",String(open));});
  closeBtn.addEventListener("click",()=>{hamburgerBtn.classList.remove("open");mobileMenu.classList.remove("open");hamburgerBtn.setAttribute("aria-expanded","false");});

  for(let year=new Date().getFullYear();year>=2000;year--){const option=document.createElement("option");option.value=String(year);option.textContent=String(year);yearSelect.appendChild(option);}

  async function loadGenres(){
    try{const data=await tmdbApi.movieGenres();(data.genres||[]).forEach(({id,name})=>{const option=document.createElement("option");option.value=id;option.textContent=name;genreSelect.appendChild(option);});}
    catch(error){console.error(error);}
  }
  loadGenres();

  applyBtn.addEventListener("click",async event=>{
    event.preventDefault();
    try{
      const params={sort_by:"popularity.desc",include_adult:"false",include_video:"false",page:1};
      if(genreSelect.value)params.with_genres=genreSelect.value;
      if(yearSelect.value)params.primary_release_year=yearSelect.value;
      const results=await discoverMovies(params);
      if(typeof window.renderAllMovies==="function")window.renderAllMovies(results);
    }catch(error){console.error(error);if(typeof window.renderAllMovies==="function")window.renderAllMovies([]);}
    hamburgerBtn.classList.remove("open");mobileMenu.classList.remove("open");hamburgerBtn.setAttribute("aria-expanded","false");
  });
})();