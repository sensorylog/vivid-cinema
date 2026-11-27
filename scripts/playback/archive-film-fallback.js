const IA_SEARCH = "https://archive.org/advancedsearch.php";
const IA_META = "https://archive.org/metadata/";
const LOC_SEARCH = "https://www.loc.gov/film-and-videos/";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const ACCEPTED_LICENSES = [
  /creativecommons\.org\/publicdomain\/(?:mark|zero)\//i,
  /creativecommons\.org\/licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0)\//i
];

function cleanText(value, max = 240) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function safeHttpUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}
function acceptedLicense(value) {
  const license = cleanText(value, 200);
  if (/\b(non.?commercial|no.?derivatives|all rights reserved|copyright restricted|rights status not evaluated|undetermined)\b/i.test(license)) return "";
  if (/public domain|cc0|cc by(?:-sa)?(?:\s|$)/i.test(license)) return license;
  if (/no known restrictions on (?:publication|use)/i.test(license)) return "No known restrictions advisory (verify item record)";
  return "";
}
export function licenseFor(metadata) {
  const url = cleanText(metadata?.licenseurl, 500);
  const rights = cleanText(metadata?.rights, 500);
  const normalized = url.toLowerCase();
  if (/-nc(?:-sa)?\//.test(normalized) || /-nd(?:-sa)?\//.test(normalized)) return null;
  const match = ACCEPTED_LICENSES.find(pattern => pattern.test(url));
  if (match) {
    if (/publicdomain\/(?:mark|zero)\//i.test(url)) return "Public-domain declaration";
    return normalized.includes("by-sa/") ? "CC BY-SA · attribution/share-alike" : "CC BY · attribution";
  }
  if (/public domain|no known copyright restrictions/i.test(rights)) return "Public-domain claim";
  return null;
}
export function hasPlayableVideo(files) {
  return (Array.isArray(files) ? files : []).some(file => {
    const name = String(file?.name || "").toLowerCase();
    const format = String(file?.format || "").toLowerCase();
    return !file?.private && (/\.(mp4|m4v|webm|ogv)$/i.test(name) || /mpeg4|h\.264|webm|ogg video/.test(format));
  });
}
async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Source returned HTTP " + response.status);
  return response.json();
}
function videoFile(files) {
  return (Array.isArray(files) ? files : []).find(file => {
    const name = String(file?.name || "").toLowerCase();
    const format = String(file?.format || "").toLowerCase();
    return !file?.private && (/\.(mp4|m4v|webm|ogv)$/i.test(name) || /mpeg4|h\.264|webm|ogg video/.test(format));
  }) || null;
}
function createCard(item, results, onPlay) {
  const card = document.createElement("article"); card.className = "vivid-archive-result";
  const details = document.createElement("div");
  const name = document.createElement("strong"); name.textContent = item.title + (item.year ? " (" + item.year + ")" : "");
  const meta = document.createElement("small"); meta.textContent = [item.providerLabel, item.creator, item.license].filter(Boolean).join(" · ");
  const link = document.createElement("a"); link.href = item.pageUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Source & rights"; link.className = "vivid-archive-source-link";
  const action = document.createElement("button"); action.type = "button"; action.textContent = "Play in Vivid"; action.addEventListener("click", () => onPlay?.(item));
  details.append(name, meta, link); card.append(details, action); results.append(card);
}
export function mountArchiveFilmSearch({ root, title = "", year = "", onPlay }) {
  if (!root || root.dataset.archiveMounted === "true") return;
  root.dataset.archiveMounted = "true";
  const section = document.createElement("section"); section.className = "vivid-archive-search";
  section.innerHTML = '<div class="vivid-archive-heading"><strong>Open Film Sources</strong><span>Choose a catalogue with playable, rights-labelled films</span></div><div class="vivid-archive-tabs" role="group" aria-label="Film source"><button type="button" data-catalog="archive" aria-pressed="true">Internet Archive</button><button type="button" data-catalog="commons" aria-pressed="false">Wikimedia Commons</button><button type="button" data-catalog="loc" aria-pressed="false">Library of Congress</button></div><form class="vivid-archive-form"><label for="vivid-archive-query">Search this source</label><div class="vivid-archive-search-row"><input id="vivid-archive-query" name="q" type="search" maxlength="120" autocomplete="off" placeholder="Search classic films" required><button type="submit">Search</button></div></form><p class="vivid-archive-note">Only direct video files or official archive players with a public-domain or compatible open-license declaration are offered. Rights metadata is not a substitute for legal advice; always inspect the original record.</p><div class="vivid-archive-results" aria-live="polite"></div>';
  root.append(section);
  const form=section.querySelector("form"), input=section.querySelector("input"), results=section.querySelector(".vivid-archive-results"), submit=section.querySelector('button[type="submit"]');
  let selected="archive", activeController=null;
  input.value=cleanText(title,120);
  const status=message=>{results.replaceChildren();const p=document.createElement("p");p.className="vivid-archive-status";p.textContent=message;results.append(p);};
  async function searchArchive(query, signal) {
    const params=new URLSearchParams({q:'title:("' + query.replace(/["\\]/g," ").trim() + '") AND mediatype:movies',output:"json",rows:"12",page:"1","fl[]":"identifier,title,year,creator"});
    const data=await fetchJson(IA_SEARCH+"?"+params,signal), docs=Array.isArray(data?.response?.docs)?data.response.docs:[];
    const found=await Promise.all(docs.slice(0,10).map(async doc=>{const id=String(doc?.identifier||"");if(!/^[a-z0-9._-]{1,180}$/i.test(id))return null;try{const md=await fetchJson(IA_META+encodeURIComponent(id),signal),license=licenseFor(md?.metadata||{});if(!license)return null;const file=videoFile(md?.files);if(!file)return null;return {provider:"archive",providerLabel:"Internet Archive",identifier:id,title:cleanText(doc.title||md.metadata?.title||id),year:cleanText(doc.year||md.metadata?.year||""),creator:cleanText(doc.creator||""),license,pageUrl:"https://archive.org/details/"+encodeURIComponent(id),embedUrl:"https://archive.org/embed/"+encodeURIComponent(id)+"?autoplay=1"};}catch{return null;}}));
    return found.filter(Boolean);
  }
  async function searchCommons(query, signal) {
    const params=new URLSearchParams({action:"query",format:"json",origin:"*",generator:"search",gsrnamespace:"6",gsrsearch:"filetype:video "+query,gsrlimit:"15",prop:"imageinfo",iiprop:"url|extmetadata"});
    const data=await fetchJson(COMMONS_API+"?"+params,signal);
    return Object.values(data?.query?.pages||{}).map(page=>{
      const info=page.imageinfo?.[0], meta=info?.extmetadata||{}, license=acceptedLicense(meta.LicenseShortName?.value||meta.License?.value||"");
      const url=safeHttpUrl(info?.url); if(!url||!license||! /\.(mp4|webm|ogv)(?:$|\?)/i.test(url))return null;
      return {provider:"commons",providerLabel:"Wikimedia Commons",title:cleanText(page.title?.replace(/^File:/,"")||"Video"),creator:cleanText(meta.Artist?.value||""),license,pageUrl:"https://commons.wikimedia.org/wiki/"+encodeURIComponent(page.title||""),videoUrl:url};
    }).filter(Boolean);
  }
  async function searchLoc(query, signal) {
    const params=new URLSearchParams({fo:"json",q:query,c:"20"});
    const data=await fetchJson(LOC_SEARCH+"?"+params,signal);
    const summaries=Array.isArray(data?.results)?data.results:[];
    const found=await Promise.all(summaries.slice(0,12).map(async summary=>{
      const itemUrl=safeHttpUrl(summary.id);
      if(!itemUrl)return null;
      try {
        const detailUrl=new URL(itemUrl);
        detailUrl.searchParams.set("fo","json");
        detailUrl.searchParams.set("at","item,resources");
        const detail=await fetchJson(detailUrl.href,signal);
        const record=detail.item||summary;
        const rightsValues=[...(Array.isArray(record.rights)?record.rights:[]),...(Array.isArray(record.rights_advisory)?record.rights_advisory:[]),...(Array.isArray(record.access_advisory)?record.access_advisory:[])];
        const license=acceptedLicense(rightsValues.join(" "));
        if(!license)return null;
        const resources=Array.isArray(detail.resources)?detail.resources:[];
        const candidates=resources.flatMap(resource=>[
          resource.url,
          resource.default?.url,
          ...(Array.isArray(resource.files)?resource.files.map(file=>file.url||file.href):[]),
          ...(Array.isArray(resource.versions)?resource.versions.map(version=>version.url):[])
        ]).map(safeHttpUrl).filter(Boolean);
        const videoUrl=candidates.find(url=>/\.mp4(?:$|[?#])/i.test(url));
        if(!videoUrl)return null;
        return {provider:"loc",providerLabel:"Library of Congress",title:cleanText(record.title||summary.title||"National Screening Room film"),year:cleanText(record.date||summary.date||""),creator:cleanText((record.contributor_names||[]).join?.(", ")||""),license,pageUrl:itemUrl,videoUrl};
      } catch { return null; }
    }));
    return found.filter(Boolean);
  }
  async function search(query) {
    if(activeController)activeController.abort(); activeController=new AbortController();
    const controller=activeController, timeoutId=window.setTimeout(()=>controller.abort(),20000);
    submit.disabled=true; status("Searching "+({archive:"Internet Archive",commons:"Wikimedia Commons",loc:"Library of Congress"}[selected])+"…");
    try {
      const found=selected==="archive"?await searchArchive(query,controller.signal):selected==="commons"?await searchCommons(query,controller.signal):await searchLoc(query,controller.signal);
      if(controller.signal.aborted)return;
      results.replaceChildren();
      if(!found.length){status("No verified playable matches were found at this source. Try a shorter title or another catalogue.");return;}
      const heading=document.createElement("p");heading.className="vivid-archive-status";heading.textContent=found.length+" playable listing"+(found.length===1?"":"s")+" with a compatible rights declaration";results.append(heading);
      found.forEach(item=>createCard(item,results,onPlay));
    } catch(error){if(error?.name!=="AbortError")status("This catalogue is temporarily unavailable. Try another source.");}
    finally{window.clearTimeout(timeoutId);if(activeController===controller)activeController=null;submit.disabled=false;}
  }
  section.querySelectorAll("[data-catalog]").forEach(button=>button.addEventListener("click",()=>{selected=button.dataset.catalog;section.querySelectorAll("[data-catalog]").forEach(node=>node.setAttribute("aria-pressed",node===button?"true":"false"));void search(cleanText(input.value,120)||cleanText(title,120));}));
  form.addEventListener("submit",event=>{event.preventDefault();const query=cleanText(input.value,120);if(query.length<2){status("Enter at least two characters to search.");return;}void search(query);});
  const initial=cleanText(title,120);if(initial.length>=2)void search(initial);
}
