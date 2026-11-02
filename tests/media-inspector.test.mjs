import test from "node:test";
import assert from "node:assert/strict";
import { inspectMediaBytes, inspectMediaUrl } from "../scripts/downloads/media-inspector.js";

const box=(type,payload)=>{const bytes=new Uint8Array(8+payload.length);new DataView(bytes.buffer).setUint32(0,bytes.length);bytes.set(new TextEncoder().encode(type),4);bytes.set(payload,8);return bytes;};
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const uint=(value)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value);return b;};

test("inspects MP4 sample-entry codec identifiers and track types",()=>{
 const ftyp=box("ftyp",new TextEncoder().encode("isom\0\0\0\0isom"));
 const stsd=box("stsd",join(new Uint8Array(4),uint(1),uint(16),new TextEncoder().encode("avc1"),new Uint8Array(8)));
 const stbl=box("stbl",stsd),minf=box("minf",stbl);
 const hdlr=box("hdlr",join(new Uint8Array(8),new TextEncoder().encode("vide"),new Uint8Array(4)));
 const mdia=box("mdia",join(hdlr,minf));
 const trak=box("trak",mdia),moov=box("moov",trak);
 const result=inspectMediaBytes(join(ftyp,moov),"test.mp4");
 assert.equal(result.format,"MP4 / ISO Base Media");
 assert.equal(result.tracks[0].kind,"video");
 assert.equal(result.tracks[0].codec,"avc1");
 assert.equal(result.complete,true);
});

test("recognises Matroska EBML signatures and reports missing track metadata honestly",()=>{
 const vintSize=value=>new Uint8Array([0x80|value]);
 const element=(id,payload)=>join(new Uint8Array([...(id.toString(16).match(/../g)||[])].map(x=>parseInt(x,16))),vintSize(payload.length),payload);
 const ebml=element(0x1a45dfa3,new Uint8Array(0));
 const segment=join(new Uint8Array([0x18,0x53,0x80,0x67,0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff]));
 const result=inspectMediaBytes(join(ebml,segment),"sample.mkv");
 assert.equal(result.format,"Matroska / WebM");
 assert.equal(result.complete,false);
 assert.match(result.note,/not found/);
});

test("range inspection requests only a bounded prefix",async()=>{
 let request;
 const fakeFetch=async(url,options)=>{request={url,options};return new Response(new Uint8Array([1,2,3]),{status:206,headers:{"content-length":"3"}});};
 const result=await inspectMediaUrl("vivid-media://download/file?token=x","x.bin",{fetchImpl:fakeFetch,maxBytes:1024});
 assert.equal(request.options.headers.Range,"bytes=0-1023");
 assert.equal(result.inspectedBytes,3);
 assert.equal(result.partial,true);
});
