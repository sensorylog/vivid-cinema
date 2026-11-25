import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accessLabel, filterAfricanCountries, filterAfricanTitles, validEditorialRecord } from "../scripts/african-stories/discovery-data.js";

const experience = JSON.parse(await readFile(new URL("../data/african-stories-experience.json", import.meta.url), "utf8"));

test("atlas defines five regions and a unique country hub index", () => {
  assert.equal(experience.regions.length, 5);
  assert.equal(experience.countries.length, 54);
  assert.equal(new Set(experience.countries.map(country => country.code)).size, 54);
  assert.ok(experience.countries.every(country => experience.regions.some(region => region.id === country.regionId)));
});

test("country discovery filters by region and search term", () => {
  assert.ok(filterAfricanCountries(experience.countries, { region: "west" }).some(country => country.code === "GH"));
  assert.deepEqual(filterAfricanCountries(experience.countries, { query: "Ghana" }).map(country => country.code), ["GH"]);
});

test("title discovery filters by country, format and query", () => {
  const titles = [
    { id: "a", countryCode: "GH", format: "documentary", title: "Coastal Memory", synopsis: "Fishing communities" },
    { id: "b", countryCode: "NG", format: "feature", title: "City Lights", synopsis: "A family story" }
  ];
  assert.deepEqual(filterAfricanTitles(titles, { country: "GH" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterAfricanTitles(titles, { format: "documentary", query: "fishing" }).map(item => item.id), ["a"]);
});

test("editorial records require publication and an evidence reference", () => {
  assert.equal(validEditorialRecord({ id: "profile-1", title: "Filmmaker", summary: "A sourced profile", evidenceRef: "archive-record-1", published: true }), true);
  assert.equal(validEditorialRecord({ id: "profile-2", title: "Unverified profile", summary: "No source", published: true }), false);
});

test("access labels keep discovery separate from viewing rights", () => {
  assert.equal(accessLabel("discover_archive_record"), "Discover / archive record");
  assert.equal(accessLabel("access_pending"), "Access pending");
});
