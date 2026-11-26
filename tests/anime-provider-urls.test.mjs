import test from "node:test";
import assert from "node:assert/strict";
import { buildAnimeEmbedUrl, buildVidyAnimeUrl, buildAniweebAnimeUrl } from "../scripts/playback/playback-urls.js";
const ids={aniListId:"21",episode:4,track:"sub"};
test("AnimeEmbed uses its documented AniList iframe route and track parameter",()=>{
 assert.equal(buildAnimeEmbedUrl(ids),"https://animeembed.com/embed/ani/21/4?track=sub&autoPlay=0");
 assert.equal(buildAnimeEmbedUrl({...ids,track:"dub",startAt:90}),"https://animeembed.com/embed/ani/21/4?track=dub&autoPlay=0&start=90");
});
test("Vidy uses AniList anime route with documented episode controls",()=>{
 assert.equal(buildVidyAnimeUrl(ids),"https://vidy.st/anime/21/4?color=E50914&episodeSelector=true&nextEpisode=true");
 assert.equal(buildVidyAnimeUrl({...ids,startAt:60}),"https://vidy.st/anime/21/4?color=E50914&episodeSelector=true&nextEpisode=true&progress=60");
});
test("Aniweeb uses its documented AniList iframe route and sub/dub track",()=>{
 assert.equal(buildAniweebAnimeUrl(ids),"https://api.aniweeb.net/embed/ani/21/4?track=sub");
 assert.equal(buildAniweebAnimeUrl({...ids,track:"dub"}),"https://api.aniweeb.net/embed/ani/21/4?track=dub");
});
test("anime provider builders reject invalid IDs and clamp zero episodes",()=>{
 assert.equal(buildAnimeEmbedUrl({aniListId:"not-a-number",episode:1}),"");
 assert.equal(buildVidyAnimeUrl({aniListId:"21",episode:0}),"https://vidy.st/anime/21/1?color=E50914&episodeSelector=true&nextEpisode=true");
 assert.equal(buildAniweebAnimeUrl({aniListId:"21",episode:0}),"https://api.aniweeb.net/embed/ani/21/1?track=sub");
});
