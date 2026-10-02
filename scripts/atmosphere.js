const reduceMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("vivid-live-ui");
document.body.classList.add("vivid-atmosphere");

if(!reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches){
  let raf=0;
  window.addEventListener("pointermove",event=>{
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      document.body.style.setProperty("--vivid-atmosphere-x",event.clientX+"px");
      document.body.style.setProperty("--vivid-atmosphere-y",event.clientY+"px");
    });
  },{passive:true});
}

const revealSelector=[
  ".vivid-rails",
  ".vivid-discovery-intro",
  ".vivid-discovery-results",
  ".vivid-collection-intro",
  ".vivid-collection-toolbar",
  ".vivid-library-header",
  ".vivid-library-tabs",
  ".account-card",
  ".vivid-title-section",
  ".vivid-watch-shell",
  ".landing-section"
].join(",");

function setupReveals(root=document){
  if(reduceMotion)return;
  const nodes=root.querySelectorAll?.(revealSelector)||[];
  if(!nodes.length)return;
  if(!("IntersectionObserver" in window)){
    nodes.forEach(node=>node.classList.add("is-visible"));
    return;
  }
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },{rootMargin:"0px 0px -8% 0px",threshold:.08});
  nodes.forEach(node=>{
    if(!node.classList.contains("vivid-reveal")){
      node.classList.add("vivid-reveal");
      observer.observe(node);
    }
  });
}
setupReveals();

function setupAmbientArtwork(){
  if(reduceMotion || document.body.matches(".vivid-landing") || document.body.matches(".vivid-watch-page")) return;
  const sources=()=>[...document.querySelectorAll("img[src]")].map(img=>img.currentSrc||img.src).filter(src=>/^https?:/i.test(src));
  const ensure=()=>{
    const list=[...new Set(sources())].slice(0,18);
    if(!list.length)return;
    let host=document.querySelector(".vivid-ambient-art");
    if(!host){
      host=document.createElement("div");
      host.className="vivid-ambient-art";
      host.setAttribute("aria-hidden","true");
      host.innerHTML='<div class="vivid-ambient-art-layer"></div><div class="vivid-ambient-art-layer"></div>';
      document.body.prepend(host);
    }
    if(host.dataset.ready)return;
    host.dataset.ready="1";
    const layers=[...host.children];
    let index=0;
    const paint=()=>{
      const src=list[index%list.length];
      const next=layers[(index+1)%2];
      const current=layers[index%2];
      next.style.backgroundImage='url("'+src.replace(/"/g,"%22")+'")';
      next.classList.add("is-visible");
      current.classList.remove("is-visible");
      index++;
    };
    paint();
    if(list.length>1)window.setInterval(paint,9000);
  };
  ensure();
  const observer=new MutationObserver(ensure);
  observer.observe(document.body,{childList:true,subtree:true});
}
setupAmbientArtwork();

const mutationObserver=new MutationObserver(records=>{
  for(const record of records){
    for(const node of record.addedNodes){
      if(node.nodeType===1){setupReveals(node);setupCardAtmosphere(node);}
    }
  }
});
mutationObserver.observe(document.body,{childList:true,subtree:true});
/* Shared scroll motion — one RAF for rails and headings. */
function setupCardAtmosphere(root=document){
  root.querySelectorAll?.(".vivid-card").forEach(card=>{
    const img=card.querySelector(".vivid-card-media img");
    if(img?.src) card.style.setProperty("--vivid-card-art",'url("'+img.src.replace(/"/g,"%22")+'")');
  });
}
setupCardAtmosphere();

(function setupSharedScrollMotion(){
  if(reduceMotion)return;
  let raf=0;
  const update=()=>{
    raf=0;
    const vh=window.innerHeight||800;
    document.querySelectorAll(".vivid-rail").forEach(rail=>{
      const rect=rail.getBoundingClientRect();
      if(rect.bottom<0||rect.top>vh)return;
      const center=rect.top+rect.height*.5;
      const delta=Math.max(-1,Math.min(1,(vh*.52-center)/(vh*.72)));
      rail.style.setProperty("--vivid-rail-shift",(delta*3.5).toFixed(2)+"px");
      const head=rail.closest(".vivid-rails")?.querySelector(".vivid-rail-head");
      if(head)head.style.setProperty("--vivid-head-shift",(delta*1.8).toFixed(2)+"px");
    });
  };
  const request=()=>{if(!raf)raf=requestAnimationFrame(update)};
  window.addEventListener("scroll",request,{passive:true});
  window.addEventListener("resize",request,{passive:true});
  request();
})();

(function setupPageTransitions(){
  if(reduceMotion)return;
  const layer=document.createElement("div");
  layer.className="vivid-page-transition";
  layer.setAttribute("aria-hidden","true");
  document.body.appendChild(layer);
  requestAnimationFrame(()=>document.body.classList.add("vivid-page-ready"));
  document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");
    if(!link||event.defaultPrevented||link.target==="_blank"||link.hasAttribute("download"))return;
    if(link.hasAttribute("data-no-page-transition")||link.hasAttribute("data-vivid-back"))return;
    if(link.matches("[download], [href^='#'], [href^='mailto:'], [href^='tel:']"))return;
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin)return;
    if(url.pathname===location.pathname&&url.search===location.search)return;
    if(url.hash&&url.pathname===location.pathname&&url.search===location.search)return;
    if(url.protocol!=="http:"&&url.protocol!=="https:")return;
    event.preventDefault();
    layer.classList.add("is-active");
    window.setTimeout(()=>{location.href=url.href},150);
  });
  window.addEventListener("pageshow",()=>layer.classList.remove("is-active"));
})();


/* Phase 5 — hero motion. No player API changes; only visual choreography around the existing iframe. */
(function setupHeroChoreography(){
  const hero=document.querySelector(".vivid-hero");
  const media=document.querySelector(".vivid-hero-media");
  const content=document.querySelector(".vivid-hero-content");
  const track=document.querySelector(".vivid-feature-track");
  if(!hero||!media)return;
  if(reduceMotion)return;
  let raf=0;
  const update=()=>{
    raf=0;
    const rect=hero.getBoundingClientRect();
    const h=Math.max(1,rect.height);
    const progress=Math.max(0,Math.min(1,-rect.top/(h*.72)));
    media.style.setProperty("--hero-progress",progress.toFixed(3));
    if(content && window.innerWidth>640){
      content.style.transform="translate3d(0,"+(progress*-22).toFixed(2)+"px,0)";
      content.style.opacity=String(1-Math.min(.16,progress*.16));
    }
    if(track && window.innerWidth>640){
      track.style.setProperty("--hero-scroll-shift",(progress*10).toFixed(2)+"px");
    }
  };
  const request=()=>{if(!raf)raf=requestAnimationFrame(update)};
  window.addEventListener("scroll",request,{passive:true});
  window.addEventListener("resize",request,{passive:true});
  request();
})();
