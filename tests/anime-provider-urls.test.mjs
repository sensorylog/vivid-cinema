import test from "node:test";
import assert from "node:assert/strict";
import { buildAnimeEmbedUrl, buildVidyAnimeUrl, buildVidlinkEmbedUrl, buildVidplusEmbedUrl, buildVidapiEmbedUrl, buildVidsrcEmbedUrl, buildEmbedWaveUrl } from "../scripts/playback/playback-urls.js";
const ids={aniListId:"21",episode:4,track:"sub"};
test("AnimeEmbed uses its documented AniList iframe route and track parameter",()=>{
 assert.equal(buildAnimeEmbedUrl(ids),"https://animeembed.com/embed/ani/21/4?track=sub&autoPlay=1");
 assert.equal(buildAnimeEmbedUrl({...ids,track:"dub",startAt:90}),"https://animeembed.com/embed/ani/21/4?track=dub&autoPlay=1&start=90");
});
test("Vidy uses AniList anime route with documented episode controls",()=>{
 assert.equal(buildVidyAnimeUrl(ids),"https://vidy.st/anime/21/4?color=E50914&autoplay=true&episodeSelector=true&nextEpisode=true");
 assert.equal(buildVidyAnimeUrl({...ids,startAt:60}),"https://vidy.st/anime/21/4?color=E50914&autoplay=true&episodeSelector=true&nextEpisode=true&progress=60");
});
test("anime provider builders reject invalid IDs and clamp zero episodes",()=>{
 assert.equal(buildAnimeEmbedUrl({aniListId:"not-a-number",episode:1}),"");
 assert.equal(buildVidyAnimeUrl({aniListId:"21",episode:0}),"https://vidy.st/anime/21/1?color=E50914&autoplay=true&episodeSelector=true&nextEpisode=true");
});

test("anime track selection maps to provider-specific sub and dub routes",()=>{
 const params={type:"tv",id:"123",season:1,episode:7};
 assert.match(buildVidlinkEmbedUrl(params,{malId:"456",anime:true,track:"dub"}),/\/anime\/456\/7\/dub\?/);
 assert.match(buildVidlinkEmbedUrl(params,{malId:"456",anime:true,track:"sub"}),/\/anime\/456\/7\/sub\?/);
 assert.match(buildVidplusEmbedUrl(params,{aniListId:"789",anime:true,track:"dub"}),/dub=true/);
 assert.match(buildVidplusEmbedUrl(params,{aniListId:"789",anime:true,track:"sub"}),/dub=false/);
});

test("VidPlus anime route receives saved playback progress", () => {
 assert.match(buildVidplusEmbedUrl({type:"tv",episode:8},{aniListId:"21",anime:true,startAt:245}),/progress=245/);
});

test("TMDB special season zero is preserved by compatibility fallback URLs", () => {
 const params={id:"12345",type:"tv",season:0,episode:2};
 assert.match(buildVidapiEmbedUrl(params),/\/tv\/12345\/0\/2/);
 assert.match(buildVidsrcEmbedUrl(params),/\/tv\/12345\/0\/2/);
 assert.match(buildEmbedWaveUrl(params),/\/tv\/12345\/0\/2/);
});
