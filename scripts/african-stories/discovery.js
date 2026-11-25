import {
  accessLabel,
  filterAfricanCountries,
  filterAfricanTitles,
  validEditorialRecord,
  validAfricanTitleRecord
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
    const routeKey = ({ Collection: "collection", People: "person", Timeline: "timeline", Journey: "journey" })[kind] || "collection";
    const link = element("a", "african-card-link", "Explore " + kind.toLowerCase());
    link.href = "african-stories.html?" + routeKey + "=" + encodeURIComponent(record.id);
    card.append(eyebrow, heading, summary, link);
    container.append(card);
  }
}

function renderRegions() {
  ui.region.replaceChildren(new Option("All regions", ""));
  for (const region of experience.regions) {
    ui.region.add(new Option(region.name, region.id));
  }
  ui.region.value = params.get("region") || "";
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


function renderEditorialDetail() {
  const detailTypes = [
    ["collection", "collections", "Collection"],
    ["person", "people", "Person"],
    ["timeline", "timelines", "Timeline"],
    ["journey", "journeys", "Documentary journey"]
  ];
  const selected = detailTypes.find(([param]) => params.has(param));
  if (!selected) return;
  const [param, key, label] = selected;
  const id = params.get(param);
  const record = (experience[key] || []).find(item => item.id === id && validEditorialRecord(item));
  const panel = document.getElementById("african-editorial-detail");
  panel.hidden = false;
  document.getElementById("african-editorial-kind").textContent = label.toUpperCase();
  document.getElementById("african-editorial-title").textContent = record?.title || label + " not published";
  document.getElementById("african-editorial-summary").textContent = record?.summary || "This editorial record is not published yet. Profiles, historical entries and curated journeys appear only after source review.";
  const references = document.getElementById("african-editorial-references");
  references.replaceChildren();
  for (const reference of (Array.isArray(record?.references) ? record.references : [])) {
    try {
      const url = new URL(reference.url);
      if (url.protocol !== "https:") continue;
      const link = element("a", "african-card-link", reference.label || "Open source reference");
      link.href = url.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      references.append(link);
    } catch {}
  }
  const related = document.getElementById("african-editorial-related");
  related.replaceChildren();
  const titleIds = new Set(Array.isArray(record?.titleIds) ? record.titleIds : []);
  const relatedTitles = (catalogue.titles || []).filter(title => titleIds.has(title.id) && validAfricanTitleRecord(title));
  for (const title of relatedTitles) {
    const card = element("article", "african-content-card");
    card.append(element("span", "african-card-eyebrow", accessLabel(title.accessState)));
    card.append(element("h3", "", title.title));
    const link = element("a", "african-card-link", "View title");
    link.href = "african-stories-watch.html?id=" + encodeURIComponent(title.id);
    card.append(link);
    related.append(card);
  }
}

function renderTitles() {
  const titles = filterAfricanTitles(catalogue.titles || [], {
    country: selectedCountry,
    query: ui.query.value,
    format: ui.format.value
  }).filter(validAfricanTitleRecord);
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
    renderEditorialDetail();
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
