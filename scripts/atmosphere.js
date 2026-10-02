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
  if(reduceMotion || document.body.matches(".vivid-landing") || document.body.matches(".vivid-watch-page") || document.querySelector(".vivid-hero-video")) return;
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
      if(node.nodeType===1)setupReveals(node);
    }
  }
});
mutationObserver.observe(document.body,{childList:true,subtree:true});
/* Phase 2 rail physics: tiny scroll-linked lift, never enough to distract. */
function setupCardAtmosphere(root=document){
  root.querySelectorAll?.(".vivid-card").forEach(card=>{
    const img=card.querySelector(".vivid-card-media img");
    if(img?.src) card.style.setProperty("--vivid-card-art",'url("'+img.src.replace(/"/g,"%22")+'")');
  });
}
setupCardAtmosphere();
let railRaf=0;
function updateRailPhysics(){
  railRaf=0;
  if(reduceMotion)return;
  const vh=window.innerHeight||800;
  document.querySelectorAll(".vivid-rail").forEach(rail=>{
    const rect=rail.getBoundingClientRect();
    if(rect.bottom<0||rect.top>vh) return;
    const center=rect.top+rect.height/2;
    const delta=Math.max(-1,Math.min(1,(vh*.52-center)/(vh*.7)));
    rail.style.setProperty("--vivid-rail-shift",(delta*3).toFixed(2)+"px");
  });
}
window.addEventListener("scroll",()=>{
  if(!railRaf)railRaf=requestAnimationFrame(updateRailPhysics);
},{passive:true});
updateRailPhysics();
