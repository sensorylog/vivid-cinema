import { escapeHtml } from "./utils.js";
const API="https://graphql.anilist.co";
const QUERY=`query($id:Int){Media(id:$id,type:ANIME){id siteUrl title{english romaji native} format status episodes season seasonYear genres averageScore popularity description(asHtml:false) studios(isMain:true){nodes{id name siteUrl}} characters(sort:ROLE,perPage:8){edges{role node{id name{full} image{large}} voiceActors(language:JAPANESE,sort:RELEVANCE,perPage:1){id name{full}}}} relations{edges{relationType(version:2) node{id type title{english romaji} format}}} recommendations(sort:RATING_DESC,perPage:8){nodes{mediaRecommendation{id title{english romaji} coverImage{large} averageScore}}} nextAiringEpisode{episode airingAt timeUntilAiring}}}`;
function safeImage(value){try{const u=new URL(value);return u.protocol==="https:"?u.href:"";}catch{return"";}}
function titleOf(media){return media?.title?.english||media?.title?.romaji||media?.title?.native||"Untitled anime";}
function link(id){return "https://anilist.co/anime/"+encodeURIComponent(String(id));}
function render(media){
 const studios=(media.studios?.nodes||[]).slice(0,5);
 const characters=(media.characters?.edges||[]).slice(0,8);
 const relations=(media.relations?.edges||[]).filter(x=>x.node?.type==="ANIME").slice(0,8);
 const recommendations=(media.recommendations?.nodes||[]).map(x=>x.mediaRecommendation).filter(Boolean).slice(0,6);
 const meta=[media.format,media.season&&media.seasonYear?media.season+" "+media.seasonYear:media.seasonYear,media.episodes?media.episodes+" episodes":"",media.status?.replaceAll("_"," ")].filter(Boolean);
 const next=media.nextAiringEpisode;
 const studioHtml=studios.map(s=>'<a href="'+link(s.id)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(s.name)+'</a>').join("");
 const genreHtml=(media.genres||[]).slice(0,8).map(g=>'<span>'+escapeHtml(g)+'</span>').join("");
 const characterHtml=characters.map(edge=>{const c=edge.node||{},voice=edge.voiceActors?.[0],image=safeImage(c.image?.large);return '<article class="vivid-anime-character">'+(image?'<img loading="lazy" src="'+escapeHtml(image)+'" alt="">':'')+'<div><strong>'+escapeHtml(c.name?.full||"Character")+'</strong><small>'+escapeHtml(edge.role||"")+(voice?" · JP voice: "+escapeHtml(voice.name?.full||""):"")+'</small></div></article>';}).join("");
 const relationHtml=relations.map(edge=>'<a href="'+link(edge.node.id)+'" target="_blank" rel="noopener noreferrer"><small>'+escapeHtml(edge.relationType||"RELATED")+'</small><strong>'+escapeHtml(titleOf(edge.node))+'</strong></a>').join("");
 const recommendationHtml=recommendations.map(item=>{const image=safeImage(item.coverImage?.large);return '<a class="vivid-anime-related" href="'+link(item.id)+'" target="_blank" rel="noopener noreferrer">'+(image?'<img loading="lazy" src="'+escapeHtml(image)+'" alt="">':'')+'<span><strong>'+escapeHtml(titleOf(item))+'</strong><small>★ '+(Number(item.averageScore)?(Number(item.averageScore)/10).toFixed(1):"—")+'</small></span></a>';}).join("");
 const airing=next?'<p class="vivid-anime-airing">Next episode: '+Number(next.episode)+' · airs in '+Math.max(0,Math.ceil(Number(next.timeUntilAiring||0)/3600))+' hours</p>':"";
 return '<div class="vivid-anime-enrichment-inner"><header><div><span>ANILIST ANIME GUIDE</span><h2>'+escapeHtml(titleOf(media))+'</h2></div><a href="'+link(media.id)+'" target="_blank" rel="noopener noreferrer">AniList ↗</a></header><div class="vivid-anime-enrichment-meta">'+meta.map(x=>'<span>'+escapeHtml(x)+'</span>').join("")+'</div>'+(media.description?'<p class="vivid-anime-description">'+escapeHtml(media.description.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim())+'</p>':"")+(genreHtml?'<div class="vivid-anime-enrichment-genres">'+genreHtml+'</div>':"")+(airing)+(studioHtml?'<section><h3>Animation studio</h3><div class="vivid-anime-studios">'+studioHtml+'</div></section>':"")+(characterHtml?'<section><h3>Characters &amp; Japanese voice cast</h3><div class="vivid-anime-characters">'+characterHtml+'</div></section>':"")+(relationHtml?'<section><h3>Franchise &amp; related entries</h3><div class="vivid-anime-relations">'+relationHtml+'</div></section>':"")+(recommendationHtml?'<section><h3>Recommended anime</h3><div class="vivid-anime-related-grid">'+recommendationHtml+'</div></section>':"")+'</div>';
}
export async function mountAnimeEnrichment({root,aniListId}={}){
 if(!root||!/^[0-9]+$/.test(String(aniListId||"")))return false;
 root.innerHTML='<div class="vivid-anime-enrichment-loading">Loading anime guide…</div>';
 try{
  const response=await fetch(API,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({query:QUERY,variables:{id:Number(aniListId)}}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("AniList metadata request failed");
  const payload=await response.json(),media=payload?.data?.Media;
  if(!media?.id)throw new Error("Anime metadata was not found");
  root.innerHTML=render(media);root.hidden=false;return true;
 }catch(error){root.innerHTML='<p class="vivid-anime-enrichment-empty">Extended anime information is temporarily unavailable.</p>';root.hidden=false;return false;}
}
