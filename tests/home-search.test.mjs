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
