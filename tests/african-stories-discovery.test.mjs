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
  const years = experience.timelines.map(item => Number((String(item.dateLabel).match(/(?:18|19|20)[0-9]{2}/) || ["0"])[0]));
  assert.ok(years.every((year, index) => index === 0 || year >= years[index - 1]));
});

test("Ghana archive, financing and video histories preserve attributed archival detail", () => {
  const byId = id => experience.timelines.find(item => item.id === id);
  assert.ok(byId("gfic-financing-crisis-1970s").summary.includes("cocoa farm"));
  assert.ok(byId("ghana-film-archive-crisis-1986-2000").summary.includes("1986"));
  assert.ok(byId("ghana-video-film-breakthrough-1987-89").summary.includes("GFIC"));
  assert.ok(byId("love-brewed-1980").summary.includes("father-in-law"));
  assert.ok(experience.collections.some(item => item.id === "ghana-lost-reels"));
  assert.ok(experience.collections.some(item => item.id === "cocoa-farm-cinema-finance"));
  assert.ok(experience.collections.some(item => item.id === "ghana-video-revolution"));
});

test("Ghanaian research contributors are credited and connected to their source records", () => {
  const scholar = experience.people.find(person => person.id === "vitus-nanbigne");
  assert.ok(scholar);
  assert.ok(scholar.selectedWorks.some(work => work.includes("Cinema in Ghana")));
  assert.ok(scholar.references.some(reference => reference.url.includes("directory.ucc.edu.gh")));
  assert.ok(experience.collections.filter(item => item.personIds?.includes("vitus-nanbigne")).length >= 3);
});

test("African film histories include camera restrictions, domestic censorship and festival gatekeeping", () => {
  const byId = id => experience.timelines.find(item => item.id === id);
  assert.ok(byId("laval-decree-1934").summary.includes("prevented colonised people from filming"));
  assert.ok(byId("laval-decree-overturned-1960").summary.includes("overturned in 1960"));
  assert.ok(byId("cairo-station-1958-censorship").summary.includes("more than a decade"));
  assert.ok(byId("fespaco-nollywood-2015").summary.includes("effectively excluded"));
  assert.ok(experience.collections.some(item => item.id === "who-was-allowed-to-film"));
  assert.ok(experience.collections.some(item => item.id === "festival-canon-video-film"));
  assert.ok(experience.collections.some(item => item.id === "egyptian-cinema-and-censorship"));
});

test("Phase 5 expands women filmmakers, disputed Nollywood origins and archive histories", () => {
  const personIds = new Set(experience.people.map(item => item.id));
  const timelineIds = new Set(experience.timelines.map(item => item.id));
  const collectionIds = new Set(experience.collections.map(item => item.id));
  const journeyIds = new Set(experience.journeys.map(item => item.id));
  assert.ok(personIds.has("annette-mbaye-derneville"));
  assert.ok(personIds.has("safi-faye"));
  assert.ok(personIds.has("therese-sita-bella"));
  assert.ok(personIds.has("nana-mahomo"));
  assert.ok(personIds.has("rebecca-ohene-asah"));
  assert.ok(timelineIds.has("nigeria-video-origins-1984-1986"));
  assert.ok(timelineIds.has("morena-clandestine-film-1970"));
  assert.ok(timelineIds.has("last-grave-dimbaza-1974"));
  assert.ok(timelineIds.has("mayibuye-afravision-archive-2000"));
  assert.ok(timelineIds.has("ghana-archive-access-research-2022"));
  assert.ok(collectionIds.has("films-that-never-travelled"));
  assert.ok(collectionIds.has("women-archive-silences"));
  assert.ok(collectionIds.has("apartheid-camera-underground"));
  assert.ok(collectionIds.has("nollywood-many-beginnings"));
  assert.ok(collectionIds.has("archive-catalogue-is-not-access"));
  assert.ok(journeyIds.has("women-screen-culture-journey"));
  assert.ok(journeyIds.has("apartheid-documentary-counter-image"));
});

test("every editorial country code maps to a published country hub", () => {
  const codes = new Set(experience.countries.map(item => item.code));
  for (const key of ["collections", "people", "timelines", "journeys"]) {
    for (const record of experience[key]) {
      assert.ok(Array.isArray(record.countryCodes) && record.countryCodes.length, key + ": " + record.id + " needs country metadata");
      assert.ok(record.countryCodes.every(code => codes.has(code)), key + ": " + record.id + " has unknown country code");
    }
  }
});

test("new archive and film-history records preserve explicit access uncertainty", () => {
  const archive = experience.collections.find(item => item.id === "archive-catalogue-is-not-access");
  const women = experience.collections.find(item => item.id === "women-archive-silences");
  const nigeria = experience.collections.find(item => item.id === "nollywood-many-beginnings");
  assert.ok(archive.confidence.includes("current access"));
  assert.ok(women.confidence.includes("title-specific"));
  assert.ok(nigeria.confidence.includes("remains disputed"));
  assert.ok(experience.people.find(item => item.id === "therese-sita-bella").selectedWorks[0].includes("not verified"));
});

test("access labels keep discovery separate from viewing rights", () => {
  assert.equal(accessLabel("discover_archive_record"), "Discover / archive record");
  assert.equal(accessLabel("access_pending"), "Access pending");
});
