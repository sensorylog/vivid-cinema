import { db } from "./firebase.js";
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $=id=>document.getElementById(id);
function dateLabel(value){
  const d=value?.toDate?value.toDate():value?new Date(value):null;
  return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}):"Date not supplied";
}
function storyCard(item){
  const image=typeof item.imageUrl==="string"&&/^https:\/\//i.test(item.imageUrl)
    ? '<img src="'+escapeHtml(item.imageUrl)+'" alt="'+escapeHtml(item.imageAlt||"")+'" loading="lazy" decoding="async">'
    : '<div class="vivid-newsroom-image-fallback"><i class="bi bi-newspaper"></i></div>';
  const tags=[item.region,item.category].filter(Boolean).map(x=>escapeHtml(String(x))).join(" · ");
  return '<article class="vivid-newsroom-card">'+image+'<div class="vivid-newsroom-card-copy"><div class="vivid-newsroom-meta">'+escapeHtml(item.publisher||"Publisher not supplied")+' · '+escapeHtml(dateLabel(item.publishedAt))+'</div><h3><a href="story.html?id='+encodeURIComponent(item.id)+'">'+escapeHtml(item.headline||"Untitled story")+'</a></h3><p>'+escapeHtml(item.summary||"Open the story for details and original reporting.")+'</p><div class="vivid-newsroom-card-foot"><span>'+tags+'</span><a href="story.html?id='+encodeURIComponent(item.id)+'">Read story <i class="bi bi-arrow-up-right"></i></a></div></div></article>';
}
async function loadStories(){
  const root=$("newsroom-stories");if(!root)return;
  try{
    const q=query(collection(db,"articles"),where("status","==","published"),orderBy("publishedAt","desc"),limit(8));
    const snap=await getDocs(q);
    if(!snap.size){root.innerHTML='<div class="vivid-newsroom-empty"><i class="bi bi-shield-check"></i><strong>The newsroom is ready for verified reporting.</strong><p>Publisher ingestion has not been connected yet. This space stays empty rather than inventing headlines, sources or publication dates.</p></div>';return;}
    root.innerHTML=snap.docs.map(d=>storyCard({id:d.id,...d.data()})).join("");
  }catch(error){console.warn("Vivid newsroom unavailable:",error);root.innerHTML='<div class="vivid-newsroom-empty"><i class="bi bi-wifi-off"></i><strong>Newsroom temporarily unavailable</strong><p>Try again later. The existing release and discovery feed remains available below.</p></div>';}
}
async function loadCommunityPreview(){
  const root=$("news-community-latest");if(!root)return;
  try{
    const q=query(collection(db,"communityPosts"),where("status","==","published"),orderBy("createdAt","desc"),limit(3));
    const snap=await getDocs(q);
    if(!snap.size){root.innerHTML='<p class="vivid-news-community-empty">Be part of the first conversations.</p>';return;}
    root.innerHTML=snap.docs.map(d=>{const x=d.data();return '<a class="vivid-news-community-preview" href="community.html"><span class="vivid-news-community-avatar"><i class="bi bi-chat-square-heart"></i></span><span><strong>'+escapeHtml(x.authorName||"Vivid member")+'</strong><small>'+escapeHtml(x.topic||"community")+'</small><span>'+escapeHtml(String(x.body||"").slice(0,125))+'</span></span><i class="bi bi-arrow-up-right"></i></a>';}).join("");
  }catch(error){console.warn("Community preview unavailable:",error);root.innerHTML='<p class="vivid-news-community-empty">Community highlights are temporarily unavailable.</p>';}
}
async function loadFeatured(){
  const root=$("newsroom-featured");if(!root)return;
  try{
    const q=query(collection(db,"articles"),where("status","==","published"),where("featured","==",true),orderBy("publishedAt","desc"),limit(1));
    const snap=await getDocs(q);
    if(!snap.size){root.hidden=true;return;}
    const d=snap.docs[0],x={id:d.id,...d.data()};
    const image=typeof x.imageUrl==="string"&&/^https:\/\//i.test(x.imageUrl)
      ? '<img src="'+escapeHtml(x.imageUrl)+'" alt="'+escapeHtml(x.imageAlt||"")+'" loading="lazy" decoding="async">'
      : '<div class="vivid-newsroom-featured-fallback"><i class="bi bi-stars"></i></div>';
    root.innerHTML='<article class="vivid-newsroom-featured-card">'+image+'<div class="vivid-newsroom-featured-copy"><span>EDITORIAL LEAD · '+escapeHtml(x.publisher||"Vivid Cinema")+' · '+escapeHtml(dateLabel(x.publishedAt))+'</span><h3><a href="story.html?id='+encodeURIComponent(x.id)+'">'+escapeHtml(x.headline||"Untitled story")+'</a></h3><p>'+escapeHtml(x.summary||"Open the original report for full details.")+'</p><a class="vivid-newsroom-featured-link" href="story.html?id='+encodeURIComponent(x.id)+'">Read the story <i class="bi bi-arrow-up-right"></i></a></div></article>';
    root.hidden=false;
  }catch(error){console.warn("Editorial lead unavailable:",error);root.hidden=true;}
}
void Promise.allSettled([loadStories(),loadFeatured(),loadCommunityPreview()]);