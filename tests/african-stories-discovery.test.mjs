import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accessLabel, filterAfricanCountries, filterAfricanTitles, validEditorialRecord, validAfricanTitleRecord } from "../scripts/african-stories/discovery-data.js";

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
    { id: "a", countryCode: "GH", format: "documentary", languages: ["Twi", "English"], title: "Coastal Memory", synopsis: "Fishing communities" },
    { id: "b", countryCode: "NG", format: "feature", languages: ["Yoruba"], title: "City Lights", synopsis: "A family story" }
  ];
  assert.deepEqual(filterAfricanTitles(titles, { country: "GH" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterAfricanTitles(titles, { format: "documentary", query: "fishing" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterAfricanTitles(titles, { language: "Yoruba" }).map(item => item.id), ["b"]);
});

test("editorial records require publication and an evidence reference", () => {
  assert.equal(validEditorialRecord({ id: "profile-1", title: "Filmmaker", summary: "A sourced profile", evidenceRef: "archive-record-1", references: [{ label: "Archive record", url: "https://archive.example/record/1" }], published: true }), true);
  assert.equal(validEditorialRecord({ id: "profile-2", title: "Unverified profile", summary: "No source", published: true }), false);
});


test("title records require provenance, edition identity and editorial approval", () => {
  const record = {
    id: "film-001", editionId: "film-001-restored", published: true,
    title: "A sourced film", synopsis: "A verified synopsis.", countryCode: "GH",
    format: "documentary", accessState: "discover_archive_record",
    provenance: { evidenceRef: "archive-item-1", sourceUrl: "https://archive.example/item/1" },
    editorialReview: { status: "approved", reviewedAt: "2026-11-25T00:00:00.000Z" }
  };
  assert.equal(validAfricanTitleRecord(record), true);
  assert.equal(validAfricanTitleRecord({ ...record, provenance: {} }), false);
  assert.equal(validAfricanTitleRecord({ ...record, editorialReview: { status: "pending" } }), false);
});

test("published Phase 5 editorial records are sourced and internally connected", () => {
  for (const key of ["collections", "people", "timelines", "journeys"]) {
    assert.ok(experience[key].length > 0, key + " should contain researched records");
    for (const record of experience[key]) {
      assert.equal(validEditorialRecord(record), true, key + ": " + record.id);
      assert.ok(record.reframe && record.whyItMatters && record.confidence, key + ": " + record.id + " needs a sourced reframe, significance and confidence note");
      assert.ok(record.references.every(reference => reference.url.startsWith("https://")));
    }
  }
  const ids = new Set(experience.timelines.map(record => record.id));
  const people = new Set(experience.people.map(record => record.id));
  for (const journey of experience.journeys) {
    assert.ok((journey.timelineIds || []).every(id => ids.has(id)), journey.id + " timeline links");
    assert.ok((journey.personIds || []).every(id => people.has(id)), journey.id + " person links");
  }
  const timelineIds = new Set(experience.timelines.map(record => record.id));
  for (const collection of experience.collections) {
    assert.ok((collection.personIds || []).every(id => people.has(id)), collection.id + " person links");
    assert.ok((collection.timelineIds || []).every(id => timelineIds.has(id)), collection.id + " timeline links");
  }
  assert.ok(experience.timelines.some(item => item.id === "love-brewed-1980" && item.dateLabel.includes("1981")));
});

test("Ghana timeline separates exhibition, safety regulation and formal censorship", () => {
  const byId = id => experience.timelines.find(item => item.id === id);
  assert.ok(byId("gold-coast-1912-safety-ordinance").summary.includes("flammable film"));
  assert.ok(byId("gold-coast-1925-censorship-board").summary.includes("formal film censorship"));
  assert.ok(byId("gold-coast-1914-first-purpose-built-theatre").summary.includes("travelling showmen"));
  assert.ok(byId("gold-coast-1923-cinema-exhibition").summary.includes("not be treated as the first time"));
  assert.ok(byId("gold-coast-film-unit-1947-48").dateLabel.includes("1949"));
  assert.ok(byId("love-brewed-1980").dateLabel.includes("1981"));
  assert.ok(experience.collections.some(item => item.id === "audiences-not-passive"));
  const years = experience.timelines.map(item => Number((String(item.dateLabel).match(/(?:18|19|20)\\d{2}/) || ["0"])[0]));
  assert.ok(years.every((year, index) => index === 0 || year >= years[index - 1]));
});

test("access labels keep discovery separate from viewing rights", () => {
  assert.equal(accessLabel("discover_archive_record"), "Discover / archive record");
  assert.equal(accessLabel("access_pending"), "Access pending");
});
