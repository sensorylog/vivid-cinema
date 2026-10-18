import test from "node:test";
import assert from "node:assert/strict";
import { cleanExcerpt, isAllowedPublisherUrl, normalizeStoryUrl, parseFeedXml, queueDocumentId } from "../automation/newsroom-ingest.mjs";

const source = { domain:"example.com", publisher:"Example Entertainment", defaultCategory:"film", defaultRegion:"india" };
const item = (title,url,date,summary) => "<item><title>"+title+"</title><link>"+url+"</link><pubDate>"+date+"</pubDate><description><![CDATA["+summary+"]]></description><dc:creator>Reporter One</dc:creator></item>";

test("source URL validation requires HTTPS and the approved host",()=>{
 assert.equal(isAllowedPublisherUrl("https://example.com/story","example.com"),true);
 assert.equal(isAllowedPublisherUrl("https://www.example.com/story","example.com"),true);
 assert.equal(isAllowedPublisherUrl("http://example.com/story","example.com"),false);
 assert.equal(isAllowedPublisherUrl("https://example.com.invalid/story","example.com"),false);
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
