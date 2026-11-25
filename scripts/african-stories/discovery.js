import {
  accessLabel,
  filterAfricanCountries,
  filterAfricanTitles,
  validEditorialRecord
} from "./discovery-data.js";

const EXPERIENCE_URL = "/data/african-stories-experience.json";
const CATALOGUE_URL = "/data/african-stories-catalog.json";
const params = new URLSearchParams(location.search);
const selectedCountry = (params.get("country") || "").toUpperCase();
const ui = {
  query: document.getElementById("african-discovery-query"),
  region: document.getElementById("african-region-filter"),
  format: document.getElementById("african-format-filter"),
  status: document.getElementById("african-discovery-status"),
  countryHub: document.getElementById("african-country-hub"),
  countryTitle: document.getElementById("african-country-title"),
  countryDescription: document.getElementById("african-country-description"),
  regions: document.getElementById("african-region-grid"),
  countries: document.getElementById("african-country-grid"),
  countryCount: document.getElementById("african-country-count"),
  collections: document.getElementById("african-collection-grid"),
  people: document.getElementById("african-people-grid"),
  timelines: document.getElementById("african-timeline-grid"),
  journeys: document.getElementById("african-journey-grid"),
  titles: document.getElementById("african-title-grid")
};
let experience = null;
let catalogue = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function emptyState(container, message) {
  container.replaceChildren(element("p", "african-empty-state", message));
}

function editorialCards(container, records, kind, emptyMessage) {
  const published = (Array.isArray(records) ? records : []).filter(validEditorialRecord);
  if (!published.length) { emptyState(container, emptyMessage); return; }
  container.replaceChildren();
  for (const record of published) {
    const card = element("article", "african-content-card");
    const eyebrow = element("span", "african-card-eyebrow", record.kicker || kind);
    const heading = element("h3", "", record.title);
    const summary = element("p", "", record.summary);
    const link = element("a", "african-card-link", "Explore " + kind.toLowerCase());
    link.href = "african-stories.html?" + kind.toLowerCase() + "=" + encodeURIComponent(record.id);
    card.append(eyebrow, heading, summary, link);
    container.append(card);
  }
}

function renderRegions() {
  ui.region.replaceChildren(new Option("All regions", ""));
  ui.region.value = params.get("region") || "";
  for (const region of experience.regions) {
    ui.region.add(new Option(region.name, region.id));
  }
  ui.regions.replaceChildren();
  for (const region of experience.regions) {
    const card = element("a", "african-region-card");
    card.href = "african-stories.html?region=" + encodeURIComponent(region.id);
    card.append(element("span", "african-card-eyebrow", "AFRICAN REGION"));
    card.append(element("h3", "", region.name));
    card.append(element("p", "", region.description));
    const count = experience.countries.filter(country => country.regionId === region.id).length;
    card.append(element("small", "", count + " country hubs"));
    ui.regions.append(card);
  }
}

function renderCountries() {
  const region = ui.region.value;
  const query = ui.query.value;
  const countries = filterAfricanCountries(experience.countries, { region, query });
  ui.countryCount.textContent = countries.length + " of " + experience.countries.length + " country hubs";
  ui.countries.replaceChildren();
  for (const country of countries) {
    const card = element("a", "african-country-card");
    card.href = "african-stories.html?country=" + encodeURIComponent(country.code);
    card.append(element("span", "african-country-code", country.code));
    card.append(element("strong", "", country.name));
    const regionName = experience.regions.find(item => item.id === country.regionId)?.name || "";
    card.append(element("small", "", regionName));
    ui.countries.append(card);
  }
  if (!countries.length) emptyState(ui.countries, "No country hubs match this search.");
}

function renderCountryHub() {
  const country = experience.countries.find(item => item.code === selectedCountry);
  if (!country) return;
  const region = experience.regions.find(item => item.id === country.regionId);
  ui.countryHub.hidden = false;
  ui.countryTitle.textContent = country.name;
  ui.countryDescription.textContent = "Explore published cinema, documentary, filmmakers and historical records connected to " + country.name + ". " + (region?.name || "");
}

function renderTitles() {
  const titles = filterAfricanTitles(catalogue.titles || [], {
    country: selectedCountry,
    query: ui.query.value,
    format: ui.format.value
  }).filter(title => title.published === true);
  ui.titles.replaceChildren();
  if (!titles.length) {
    emptyState(ui.titles, "No verified title records are published here yet. The atlas will only display records with editorial evidence and an explicit access status.");
    return;
  }
  for (const title of titles) {
    const card = element("article", "african-content-card african-title-card");
    card.append(element("span", "african-card-eyebrow", accessLabel(title.accessState)));
    card.append(element("h3", "", title.title));
    card.append(element("p", "", title.synopsis || "No synopsis has been published."));
    const meta = [title.countryName, title.format, ...(title.languages || [])].filter(Boolean).join(" · ");
    card.append(element("small", "african-title-meta", meta));
    const link = element("a", "african-card-link", "View title & access details");
    link.href = "african-stories-watch.html?id=" + encodeURIComponent(title.id);
    card.append(link);
    ui.titles.append(card);
  }
}

function render() {
  renderCountries();
  renderTitles();
}

async function load() {
  try {
    const [experienceResponse, catalogueResponse] = await Promise.all([
      fetch(EXPERIENCE_URL, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" }),
      fetch(CATALOGUE_URL, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
    ]);
    if (!experienceResponse.ok || !catalogueResponse.ok) throw new Error("The African Stories atlas is temporarily unavailable.");
    experience = await experienceResponse.json();
    catalogue = await catalogueResponse.json();
    if (experience.schemaVersion !== 1 || !Array.isArray(experience.regions) || !Array.isArray(experience.countries) ||
        catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.titles)) throw new Error("The African Stories data format is not supported.");
    renderRegions();
    renderCountryHub();
    editorialCards(ui.collections, experience.collections, "Collection", "Curated collections are being prepared with sourced title records.");
    editorialCards(ui.people, experience.people, "People", "Filmmaker and cultural-person profiles will appear when biographies and filmographies are sourced.");
    editorialCards(ui.timelines, experience.timelines, "Timeline", "Historical timelines are being researched. Dates and events will be published with references.");
    editorialCards(ui.journeys, experience.journeys, "Journey", "Documentary journeys will connect published titles, people and places.");
    render();
    ui.status.textContent = "Explore " + experience.countries.length + " country hubs across " + experience.regions.length + " African regions. Published title and editorial records are added only after review.";
  } catch (error) {
    ui.status.textContent = error instanceof Error ? error.message : "The African Stories atlas could not be loaded.";
  }
}

ui.query?.addEventListener("input", render);
ui.region?.addEventListener("change", renderCountries);
ui.format?.addEventListener("change", renderTitles);
load();
