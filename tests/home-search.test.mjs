import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../home.html");
const script = read("../script.js");

test("Home search wires both desktop and mobile triggers without following the mobile hash", () => {
  assert.equal((home.match(/data-search-trigger/g) || []).length, 2);
  assert.match(script, /querySelectorAll\("\[data-search-trigger\]"\)/);
  assert.match(script, /triggers\.forEach\(trigger=>trigger\.addEventListener\("click",event=>\{/);
  assert.match(script, /event\.preventDefault\(\);\s*openSearch\(\);/);
});

test("Home search focuses the input synchronously so iOS can open its keyboard", () => {
  const openSearch = script.match(/function openSearch\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(openSearch, /dialog\.hidden=false;[\s\S]*?searchInput\?\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(openSearch, /requestAnimationFrame\([\s\S]*?searchInput\?\.focus/);
});


test("Home search refreshes recent suggestions when account-scoped history becomes ready", () => {
  assert.match(script, /vivid:search-history-ready/);
  assert.match(script, /if \(changedOwner\)/);
  assert.match(script, /searchRequestId\+\+/);
});


test("Home search does not upload raw query text as behavior-event metadata", () => {
  assert.doesNotMatch(script, /recordBehavior\("search_query",\s*null,\s*\{\s*query\s*\}\)/);
  assert.match(script, /rememberSearch\(query,searchOwnerAtStart\)/);
  const privacy = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");
  assert.match(privacy, /Search terms are sent to TMDB/);
  assert.match(privacy, /raw search text is not uploaded as behaviour-event metadata/);
});
