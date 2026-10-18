import test from "node:test";
import assert from "node:assert/strict";
import { cleanExcerpt, isAllowedFeedUrl, isAllowedPublisherUrl, normalizeStoryUrl, parseFeedXml, queueDocumentId, runIngestion, fetchApprovedFeed } from "../automation/newsroom-ingest.mjs";

const source = { domain:"example.com", publisher:"Example Entertainment", defaultCategory:"film", defaultRegion:"india" };
const item = (title,url,date,summary) => "<item><title>"+title+"</title><link>"+url+"</link><pubDate>"+date+"</pubDate><description><![CDATA["+summary+"]]></description><dc:creator>Reporter One</dc:creator></item>";

test("source URL validation requires HTTPS and the approved host",()=>{
 assert.equal(isAllowedPublisherUrl("https://example.com/story","example.com"),true);
 assert.equal(isAllowedPublisherUrl("https://www.example.com/story","example.com"),true);
 assert.equal(isAllowedPublisherUrl("http://example.com/story","example.com"),false);
 assert.equal(isAllowedPublisherUrl("https://example.com.invalid/story","example.com"),false);
 assert.equal(isAllowedPublisherUrl("https://rss.example.com/story","example.com"),false);
 assert.equal(isAllowedFeedUrl("https://rss.example.com/feed.xml","example.com"),true);
 assert.equal(isAllowedFeedUrl("https://rss.example.com:8443/feed.xml","example.com"),false);
});

test("canonical URL strips tracking parameters and fragments",()=>{
 assert.equal(normalizeStoryUrl("https://www.example.com/story/?utm_source=feed&fbclid=abc#comments","example.com"),"https://www.example.com/story");
});

test("RSS parsing extracts metadata, cleans excerpts and deduplicates URLs",()=>{
 const date=new Date().toUTCString();
 const xml="<rss><channel>"+
 item("A Verified Film Announcement","https://example.com/story?utm_source=rss",date,"<p>Short <strong>publisher excerpt</strong>.</p>")+
 item("Duplicate Announcement Headline","https://example.com/story#duplicate",date,"another excerpt")+
 item("External Link Is Skipped","https://example.org/story",date,"not ours")+
 "</channel></rss>";
 const result=parseFeedXml(xml,source);
 assert.equal(result.length,1);
 assert.equal(result[0].headline,"A Verified Film Announcement");
 assert.equal(result[0].canonicalUrl,"https://example.com/story");
 assert.equal(result[0].publisher,"Example Entertainment");
 assert.equal(result[0].author,"Reporter One");
 assert.equal(result[0].region,"india");
 assert.equal(result[0].excerpt,"Short publisher excerpt.");
});

test("Atom parsing accepts alternate links",()=>{
 const date=new Date().toISOString();
 const xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Fresh Asian Cinema Update</title><link rel="alternate" href="https://example.com/asia/story?utm_medium=atom"/><published>'+date+'</published><summary>Brief &amp; clear summary.</summary></entry></feed>';
 const result=parseFeedXml(xml,{...source,defaultRegion:"asia"});
 assert.equal(result.length,1);
 assert.equal(result[0].canonicalUrl,"https://example.com/asia/story");
 assert.equal(result[0].region,"asia");
 assert.equal(result[0].excerpt,"Brief & clear summary.");
});

test("excerpt cleanup and queue identifiers are bounded and stable",()=>{
 assert.equal(cleanExcerpt("<p>Hello <b>world</b></p>"),"Hello world");
 assert.ok(cleanExcerpt("long ".repeat(200),80).length<=80);
 assert.equal(queueDocumentId("example.com","https://example.com/a"),queueDocumentId("example.com","https://example.com/a"));
 assert.notEqual(queueDocumentId("example.com","https://example.com/a"),queueDocumentId("example.com","https://example.com/b"));
});


test("feed redirects stay on the approved domain", async () => {
  let calls = 0;
  const goodFetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(null,{status:302,headers:{location:"/feed-v2.xml"}});
    return new Response("<rss/>",{status:200});
  };
  assert.equal(await fetchApprovedFeed("https://example.com/feed.xml",source.domain,goodFetch),"<rss/>");
  assert.equal(calls,2);
  const badFetch = async () => new Response(null,{status:302,headers:{location:"https://elsewhere.example/feed.xml"}});
  await assert.rejects(fetchApprovedFeed("https://example.com/feed.xml",source.domain,badFetch),/outside the approved publisher domain/);
});

test("ingestion only stages new pending-review metadata for explicitly enabled sources", async () => {
  const date = new Date().toUTCString();
  const xml = "<rss><channel>" + item("A Verified Film Announcement","https://example.com/story",date,"Publisher excerpt only.") + "</channel></rss>";
  const sources = [
    {id:"example.com",data:()=>({...source,status:"approved",feedApproved:true,ingestionEnabled:true,feedUrl:"https://example.com/feed.xml"})},
    {id:"off.example",data:()=>({...source,domain:"off.example",feedUrl:"https://off.example/feed.xml",ingestionEnabled:false})}
  ];
  const stored = new Map();
  const db = {
    collection(name) {
      if (name === "newsSources") return {where:()=>({get:async()=>({docs:sources})})};
      if (name === "newsQueue") return {doc(id){return {create:async value=>{
        if(stored.has(id)){const error=new Error("Already exists");error.code=6;throw error;}
        stored.set(id,value);
      }};}};
      throw new Error("Unexpected collection " + name);
    }
  };
  const fetchImpl = async () => new Response(xml,{status:200});
  const first = await runIngestion({apply:true,db,fetchImpl,now:new Date(),log:()=>{}});
  assert.equal(first.enabledSources,1);
  assert.equal(first.staged,1);
  assert.equal(first.errors.length,0);
  const candidate=[...stored.values()][0];
  assert.equal(candidate.status,"pending_review");
  assert.equal(candidate.headline,"A Verified Film Announcement");
  assert.equal(candidate.excerpt,"Publisher excerpt only.");
  assert.equal("body" in candidate,false);
  assert.equal("imageUrl" in candidate,false);
  const second = await runIngestion({apply:true,db,fetchImpl,now:new Date(),log:()=>{}});
  assert.equal(second.staged,0);
  assert.equal(second.duplicates,1);
  assert.equal(stored.size,1);
});

test("dry-run reports candidates without writing to Firestore", async () => {
  const date = new Date().toUTCString();
  const xml = "<rss><channel>" + item("A Verified Film Announcement","https://example.com/story",date,"Publisher excerpt only.") + "</channel></rss>";
  let writes=0;
  const db = {
    collection(name) {
      if(name==="newsSources") return {where:()=>({get:async()=>({docs:[{id:"example.com",data:()=>({...source,status:"approved",feedApproved:true,ingestionEnabled:true,feedUrl:"https://example.com/feed.xml"})}]})})};
      if(name==="newsQueue") return {doc:()=>({create:async()=>{writes+=1;}})};
      throw new Error("Unexpected collection " + name);
    }
  };
  const result=await runIngestion({apply:false,db,fetchImpl:async()=>new Response(xml),now:new Date(),log:()=>{}});
  assert.equal(result.staged,1);
  assert.equal(writes,0);
});
