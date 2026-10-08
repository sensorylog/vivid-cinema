#!/usr/bin/env node
import fs from "node:fs/promises";

const BASE="https://www.2embed.online/iptv/";
const TOTAL_PAGES=195;
const out="data/live-channels.json";

function decode(value){
  return value.replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">");
}
function clean(value){return decode(value).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}

const rows=new Map();
for(let page=1;page<=TOTAL_PAGES;page++){
  const url=`${BASE}?category=&country=&page=${page}&search=`;
  const html=await (await fetch(url,{headers:{"user-agent":"Vivid-Cinema live catalogue sync"}})).text();
  const matches=[...html.matchAll(/https?:\\/\\/www\\.2embed\\.online\\/iptv\\/stream\\.php\\?url=[^"'<>\\s]+/g)];
  for(const match of matches){
    const streamUrl=decode(match[0]);
    const titleMatch=streamUrl.match(/[?&]title=([^&]+)/);
    const name=titleMatch?decode(decodeURIComponent(titleMatch[1].replace(/\\+/g," "))):"";
    if(!name) continue;
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    rows.set(streamUrl,{id,name,category:"live",country:"International",streamUrl});
  }
  process.stdout.write(`\\rPage ${page}/${TOTAL_PAGES} · ${rows.size} streams found`);
}
process.stdout.write("\\n");
if(!rows.size) throw new Error("2Embed returned no channel-specific stream.php URLs. The site may require a browser interaction; no invented URLs were written.");
await fs.writeFile(out,JSON.stringify([...rows.values()],null,2)+"\\n");
console.log(`Wrote ${rows.size} verified channels to ${out}`);
