import test from "node:test";
import assert from "node:assert/strict";
import { createFlixQuestApi } from "../scripts/downloads/flixquest-api.js";

const response = body => ({ ok: true, status: 200, json: async () => body });

test("requires a clean HTTPS API base URL and appends v2", () => {
  assert.throws(() => createFlixQuestApi({ baseUrl: "http://localhost:3000" }), /HTTPS/);
  assert.throws(() => createFlixQuestApi({ baseUrl: "https://user:pass@example.com" }), /HTTPS/);
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example" , fetchImpl: async () => response({providers:[]})});
  assert.equal(typeof api.getProviders, "function");
});

test("lists enabled providers and sends requests without credentials", async () => {
  let requested;
  const api = createFlixQuestApi({
    baseUrl: "https://scraper.example/api/v2/",
    fetchImpl: async (url, init) => { requested = {url,init}; return response({providers:[{id:"alpha",name:"Alpha",enabled:true},{id:"off",enabled:false}]}); }
  });
  assert.deepEqual(await api.getProviders(), [{id:"alpha",name:"Alpha"}]);
  assert.match(requested.url, /\/api\/v2\/providers$/);
  assert.equal(requested.init.credentials, "omit");
  assert.equal(requested.init.redirect, "error");
});

test("builds documented movie and TV resolver requests", async () => {
  const urls=[];
  const api=createFlixQuestApi({baseUrl:"https://scraper.example",fetchImpl:async url=>{urls.push(new URL(url));return response({links:[]});}});
  await api.getStreams({mediaType:"movie",tmdbId:123,providerId:"alpha"});
  await api.getStreams({mediaType:"tv",tmdbId:456,providerId:"alpha",season:2,episode:4});
  assert.equal(urls[0].pathname,"/api/v2/stream-movie");
  assert.equal(urls[0].searchParams.get("tmdbId"),"123");
  assert.equal(urls[1].pathname,"/api/v2/stream-tv");
  assert.equal(urls[1].searchParams.get("season"),"2");
  assert.equal(urls[1].searchParams.get("episode"),"4");
});

test("never treats ordinary stream links as downloadable files", async () => {
  const api=createFlixQuestApi({baseUrl:"https://scraper.example",fetchImpl:async()=>response({links:[
    {url:"https://cdn.example/video.m3u8",quality:"1080p",isM3U8:true},
    {url:"https://cdn.example/movie.mp4",quality:"720p",mimeType:"video/mp4"}
  ]})});
  assert.deepEqual(await api.getDownloadOptions({mediaType:"movie",tmdbId:1,providerId:"alpha"}),[]);
  await assert.rejects(api.resolveDownload({mediaType:"movie",tmdbId:1,providerId:"alpha"},"0"),/did not explicitly authorize/);
});

test("accepts only explicit offline direct-file metadata", async () => {
  const api=createFlixQuestApi({baseUrl:"https://scraper.example",fetchImpl:async()=>response({links:[
    {id:"stream",url:"https://cdn.example/a.mp4",quality:"1080p",offlineDownload:true,mimeType:"video/mp4"},
    {id:"manifest",downloadUrl:"https://cdn.example/a.m3u8",offlineDownload:true,mimeType:"application/vnd.apple.mpegurl"},
    {id:"wrong",downloadUrl:"https://cdn.example/a.mp4",offlineDownload:false,mimeType:"video/mp4"}
  ]})});
  const args={mediaType:"movie",tmdbId:1,providerId:"alpha"};
  assert.deepEqual(await api.getDownloadOptions(args),[{id:"stream",quality:"1080p",mimeType:"video/mp4"}]);
  assert.deepEqual(await api.resolveDownload(args,"stream"),{url:"https://cdn.example/a.mp4",mimeType:"video/mp4"});
});

test("propagates abort signals and API errors", async () => {
  const api=createFlixQuestApi({baseUrl:"https://scraper.example",fetchImpl:async()=>({ok:false,status:503,json:async()=>({message:"Unavailable"})})});
  await assert.rejects(api.getProviders(),/Unavailable/);
});
