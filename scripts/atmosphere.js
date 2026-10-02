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

const mutationObserver=new MutationObserver(records=>{
  for(const record of records){
    for(const node of record.addedNodes){
      if(node.nodeType===1)setupReveals(node);
    }
  }
});
mutationObserver.observe(document.body,{childList:true,subtree:true});