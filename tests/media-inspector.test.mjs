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

test("a server that ignores Range cannot make inspection read beyond its byte budget", async () => {
  let cancelled = false;
  const payload = new Uint8Array(1536).fill(7);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(payload.subarray(0, 512));
      controller.enqueue(payload.subarray(512, 1024));
      controller.enqueue(payload.subarray(1024));
      controller.close();
    },
    cancel() { cancelled = true; }
  });
  const fakeFetch = async () => new Response(body, {
    status: 200,
    headers: { "content-length": String(payload.length) }
  });
  const result = await inspectMediaUrl("vivid-media://download/file", "large.mkv", {
    fetchImpl: fakeFetch,
    maxBytes: 1024
  });
  assert.equal(result.inspectedBytes, 1024);
  assert.equal(result.fileSize, 1536);
  assert.equal(result.partial, true);
});

test("a ranged response covering the complete small file is not labelled partial", async () => {
  const fakeFetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 206,
    headers: { "content-length": "3", "content-range": "bytes 0-2/3" }
  });
  const result = await inspectMediaUrl("vivid-media://download/file", "tiny.mkv", {
    fetchImpl: fakeFetch,
    maxBytes: 1024
  });
  assert.equal(result.inspectedBytes, 3);
  assert.equal(result.fileSize, 3);
  assert.equal(result.partial, false);
});

test("parses Matroska tracks, codec identifiers, language and duration with an unknown-size Segment", () => {
  const vintSize = value => new Uint8Array([0x80 | value]);
  const idBytes = id => new Uint8Array((id.toString(16).match(/../g) || []).map(part => parseInt(part, 16)));
  const element = (id, payload) => join(idBytes(id), vintSize(payload.length), payload);
  const unknownSegmentSize = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const scale = element(0x2ad7b1, new Uint8Array([0x0f, 0x42, 0x40]));
  const durationBytes = new Uint8Array(8);
  new DataView(durationBytes.buffer).setFloat64(0, 60000, false);
  const info = element(0x1549a966, join(scale, element(0x4489, durationBytes)));
  const trackEntry = element(0xae, join(
    element(0x83, new Uint8Array([1])),
    element(0x86, new TextEncoder().encode("V_MPEG4/ISO/AVC")),
    element(0x22b59c, new TextEncoder().encode("eng"))
  ));
  const tracks = element(0x1654ae6b, trackEntry);
  const segment = join(idBytes(0x18538067), unknownSegmentSize, info, tracks);
  const file = join(element(0x1a45dfa3, new Uint8Array(0)), segment);
  const result = inspectMediaBytes(file, "sample.mkv");
  assert.equal(result.format, "Matroska / WebM");
  assert.equal(result.complete, true);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].kind, "video");
  assert.equal(result.tracks[0].codec, "V_MPEG4/ISO/AVC");
  assert.equal(result.tracks[0].language, "eng");
  assert.equal(result.duration, 60);
});

test("finds MP4 movie metadata in the trailing region after a bounded prefix scan", async () => {
  const ftyp = box("ftyp", new TextEncoder().encode("isom\\0\\0\\0\\0isom"));
  const stsd = box("stsd", join(new Uint8Array(4), uint(1), uint(16), new TextEncoder().encode("avc1"), new Uint8Array(8)));
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const hdlr = box("hdlr", join(new Uint8Array(8), new TextEncoder().encode("vide"), new Uint8Array(4)));
  const moov = box("moov", box("trak", box("mdia", join(hdlr, minf))));
  const totalSize = 2000;
  const tailStart = totalSize - 1024;
  const tailBytes = new Uint8Array(1024);
  tailBytes.set(moov);
  const ranges = [];
  const fakeFetch = async (_url, options) => {
    const range = options.headers.Range;
    ranges.push(range);
    if (range === "bytes=0-1023") {
      return new Response(ftyp, {
        status: 206,
        headers: {
          "content-length": String(ftyp.length),
          "content-range": "bytes 0-" + (ftyp.length - 1) + "/" + totalSize
        }
      });
    }
    return new Response(tailBytes, {
      status: 206,
      headers: {
        "content-length": String(tailBytes.length),
        "content-range": "bytes " + tailStart + "-" + (totalSize - 1) + "/" + totalSize
      }
    });
  };
  const result = await inspectMediaUrl("vivid-media://download/file", "tail-index.mp4", {
    fetchImpl: fakeFetch,
    maxBytes: 1024
  });
  assert.deepEqual(ranges, ["bytes=0-1023", "bytes=976-1999"]);
  assert.equal(result.complete, true);
  assert.equal(result.tracks[0].codec, "avc1");
  assert.equal(result.partial, true);
  assert.match(result.note, /trailing region/);
});


test("inspection refuses an unbounded response when streaming is unavailable", async () => {
  const fakeFetch = async () => new Response(null, { status: 200 });
  await assert.rejects(
    inspectMediaUrl("vivid-media://download/file", "unknown-size.mkv", {
      fetchImpl: fakeFetch,
      maxBytes: 1024
    }),
    /verifiably bounded/
  );
});

test("reads nominal MP4 frame rate from the video sample timing table", () => {
  const ftyp = box("ftyp", new TextEncoder().encode("isom\\0\\0\\0\\0isom"));
  const stsd = box("stsd", join(new Uint8Array(4), uint(1), uint(16), new TextEncoder().encode("avc1"), new Uint8Array(8)));
  const stts = box("stts", join(new Uint8Array(4), uint(1), uint(240), uint(1000)));
  const stbl = box("stbl", join(stsd, stts));
  const minf = box("minf", stbl);
  const hdlr = box("hdlr", join(new Uint8Array(8), new TextEncoder().encode("vide"), new Uint8Array(4)));
  const mdhd = box("mdhd", join(new Uint8Array(4), uint(0), uint(0), uint(24000), uint(240000)));
  const mdia = box("mdia", join(hdlr, mdhd, minf));
  const result = inspectMediaBytes(join(ftyp, box("moov", box("trak", mdia))), "24fps.mp4");
  assert.equal(result.tracks[0].frameRate, 24);
});

test("reads nominal Matroska frame rate from DefaultDuration", () => {
  const vintSize = value => new Uint8Array([0x80 | value]);
  const idBytes = id => new Uint8Array((id.toString(16).match(/../g) || []).map(part => parseInt(part, 16)));
  const element = (id, payload) => join(idBytes(id), vintSize(payload.length), payload);
  const track = element(0xae, join(
    element(0x83, new Uint8Array([1])),
    element(0x86, new TextEncoder().encode("V_MPEG4/ISO/AVC")),
    element(0x23e383, new Uint8Array([0x02, 0x62, 0x5a, 0x00]))
  ));
  const segment = join(idBytes(0x18538067), new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), element(0x1654ae6b, track));
  const file = join(element(0x1a45dfa3, new Uint8Array(0)), segment);
  const result = inspectMediaBytes(file, "25fps.mkv");
  assert.equal(result.tracks[0].frameRate, 25);
});
