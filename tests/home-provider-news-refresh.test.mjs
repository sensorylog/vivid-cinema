import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");

test("provider shelves retry the US catalogue when the selected region has no titles", async () => {
  const source = await read("scripts/content.js");
  assert.match(source, /async function providerDiscover\(providerId, type, page = 1, region = getProviderCountry\(\)\)/);
  assert.match(source, /let items = \[\]/);
  assert.match(source, /try \{ items = await loadRegion\(region\); \}/);
  assert.match(source, /if \(!items\.length && region !== "US"\)/);
  assert.match(source, /providerId\.filter\(id => \[2303, 2304, 2616, 531\]/);
  assert.match(source, /providerDiscover\(id, "movie", 1, "US"\)/);
  assert.match(source, /paramountPlus: \[2303, 2304, 2616, 531, 582, 633, 1853\]/);
  assert.ok(source.includes('Array.isArray(providerId) ? providerId : [providerId]'));
  assert.match(source, /if \(!fulfilled\.length\)\s*\{\s*throw results\.find\(result => result\.status === "rejected"\)/);
});

test("scheduled news refresh publishes the static feed through the primary site", async () => {
  const workflow = await read(".github/workflows/refresh-static-news.yml");
  assert.match(workflow, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /node automation\/build-static-news-feed\.mjs/);
  assert.match(workflow, /git add data\/news-feed\.json/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /FirebaseExtended\/action-hosting-deploy/);
});
