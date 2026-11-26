import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
const source=await readFile(new URL("../scripts/anime-enrichment.js",import.meta.url),"utf8");
const watch=await readFile(new URL("../scripts/watch.js",import.meta.url),"utf8");
test("anime enrichment provides studio, cast, franchise and recommendation metadata",()=>{for(const key of ["studios","characters","relations","recommendations","nextAiringEpisode"])assert.match(source,new RegExp(key));});
test("anime enrichment sanitizes external metadata and uses secure AniList links",()=>{assert.match(source,/escapeHtml/);assert.match(source,/u\.protocol==="https:"/);assert.match(source,/rel="noopener noreferrer"/);});
test("watch page mounts optional AniList enrichment only for matched anime IDs",()=>{assert.match(watch,/mountAnimeEnrichment/);assert.match(watch,/aniListId/);});
