import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const page=await readFile(new URL("../anime.html",import.meta.url),"utf8");
const script=await readFile(new URL("../scripts/anime.js",import.meta.url),"utf8");
const discovery=await readFile(new URL("../scripts/anime-discovery.js",import.meta.url),"utf8");
test("anime discovery exposes search and advanced filters",()=>{
 for(const id of ["anime-search","anime-genre","anime-year","anime-decade","anime-rating"])assert.match(page,new RegExp('id="'+id+'"'));
 for(const shelf of ["trending","seasonal","airing","upcoming"])assert.match(page,new RegExp('data-anime-shelf="'+shelf+'"'));
});
test("anime discovery constrains catalogue to animation and Japanese-language titles",()=>{
 assert.match(discovery,/with_genres:ANIMATION_GENRE/);assert.match(discovery,/with_original_language:"ja"/);
 assert.match(discovery,/with_text_query/);assert.match(discovery,/filters.decade/);assert.match(discovery,/first_air_date\.gte/);assert.match(discovery,/primary_release_date\.gte/);
});
test("decade changes immediately reload the catalogue and trending uses the full decade range",()=>{assert.match(script,/\["anime-type","anime-genre","anime-year","anime-decade","anime-rating","anime-sort"\]/);assert.match(discovery,/year<start\|\|year>start\+9/);});
test("anime controls submit searches, reset filters and use stale-request protection",()=>{
 assert.match(script,/addEventListener\("submit"/);assert.match(script,/data-anime-shelf/);assert.match(script,/requestToken/);assert.match(script,/getAnimePage/);
});

test("anime search offers debounced AniList autocomplete suggestions",()=>{
 assert.match(page,/list="anime-search-suggestions"/);
 assert.match(script,/addEventListener\("input"/);
 assert.match(script,/graphql\.anilist\.co/);
 assert.match(script,/AbortController/);
});
