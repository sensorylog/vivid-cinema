import {
  buildOfficialEmbed,
  fetchFilmFluxTrending,
  getOfficialSourceFallback,
  resolveInternetArchiveFile
} from "./providers.js";
import { requestAfricanProviderSession } from "./provider-session.js";
import { playAuthorizedMedia, stopAuthorizedMedia } from "./media-player.js";
import {
  getAfricanAccessMessage,
  getPlayableAfricanSources
} from "./policy.js";
import { accessLabel } from "./discovery-data.js";

const CATALOGUE_URL = "/data/african-stories-catalog.json";
const SOURCE_TIMEOUT_MS = 12000;
const params = new URLSearchParams(window.location.search);
const titleId = params.get("id") || "";

const ui = {
  title: document.getElementById("african-player-title"),
  description: document.getElementById("african-player-description"),
  state: document.getElementById("african-player-state"),
  sourceLabel: document.getElementById("african-player-source-label"),
  frame: document.getElementById("african-player-frame"),
  video: document.getElementById("african-player-video"),
  sources: document.getElementById("african-player-sources"),
  fallback: document.getElementById("african-player-fallback"),
  filmFluxPanel: document.getElementById("african-filmflux-panel"),
  filmFluxStatus: document.getElementById("african-filmflux-status"),
  filmFluxList: document.getElementById("african-filmflux-list")
};

function setState(heading, message, label = "SOURCE CHECK") {
  if (ui.state) {
    ui.state.hidden = false;
    const h = ui.state.querySelector("h2");
    const p = ui.state.querySelector("p");
    if (h) h.textContent = heading;
    if (p) p.textContent = message;
  }
  if (ui.sourceLabel) ui.sourceLabel.textContent = label;
  if (ui.fallback) ui.fallback.hidden = true;
  if (ui.frame) { ui.frame.hidden = true; ui.frame.removeAttribute("src"); }
  if (ui.video) {
    stopAuthorizedMedia(ui.video);
    ui.video.pause();
    ui.video.hidden = true;
    ui.video.removeAttribute("src");
    ui.video.load();
  }
}

function showFrame(url, providerOrigin, source) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ui.frame.removeEventListener("load", onLoad);
      ui.frame.removeEventListener("error", onError);
      resolve(value);
    };
    const onLoad = () => {
      // iframe load confirms navigation only, not successful playback.
      ui.state.hidden = true;
      ui.frame.hidden = false;
      if (ui.sourceLabel) ui.sourceLabel.textContent = "OFFICIAL PLAYER LOADED";
      finish(true);
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), SOURCE_TIMEOUT_MS);
    ui.frame.addEventListener("load", onLoad, { once: true });
    ui.frame.addEventListener("error", onError, { once: true });
    ui.frame.title = source.label || providerOrigin + " official player";
    ui.frame.src = url;
  });
}

function showArchiveVideo(resolved) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ui.video.removeEventListener("loadedmetadata", onReady);
      ui.video.removeEventListener("error", onError);
      resolve(value);
    };
    const onReady = () => {
      ui.state.hidden = true;
      ui.video.hidden = false;
      if (ui.sourceLabel) ui.sourceLabel.textContent = "PUBLIC ARCHIVE FILE";
      finish(true);
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), SOURCE_TIMEOUT_MS);
    ui.video.addEventListener("loadedmetadata", onReady, { once: true });
    ui.video.addEventListener("error", onError, { once: true });
    ui.video.src = resolved.url;
    ui.video.load();
  });
}

function renderSourceButtons(sources, activeSourceId, onSelect) {
  if (!ui.sources) return;
  ui.sources.replaceChildren();
  for (const source of sources) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "african-source-button";
    button.dataset.sourceId = source.sourceId;
    button.textContent = source.label || source.provider;
    button.setAttribute("aria-pressed", String(source.sourceId === activeSourceId));
    button.addEventListener("click", () => {
      for (const candidate of ui.sources.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
      onSelect(source);
    });
    ui.sources.append(button);
  }
  ui.sources.hidden = sources.length < 2;
}

async function activateSource(title, source, sources) {
  for (const button of ui.sources?.querySelectorAll("button") || []) button.setAttribute("aria-pressed", String(button.dataset.sourceId === source.sourceId));
  setState("Checking source", "Verifying the authorized source record and preparing its official player.");
  try {
    if (source.provider === "partner") {
      const session = await requestAfricanProviderSession(title, source);
      await playAuthorizedMedia(ui.video, session);
      ui.frame.hidden = true;
      ui.state.hidden = true;
      ui.video.hidden = false;
      if (ui.sourceLabel) ui.sourceLabel.textContent = "AUTHORIZED PARTNER STREAM";
      if (ui.fallback) ui.fallback.hidden = true;
      return;
    }
    if (source.provider === "archive") {
      const resolved = await resolveInternetArchiveFile(source);
      const ok = await showArchiveVideo(resolved);
      if (!ok) throw new Error("The public archive file did not become playable.");
      if (ui.fallback) {
        ui.fallback.href = resolved.itemUrl;
        ui.fallback.textContent = "Open Internet Archive item";
        ui.fallback.hidden = false;
      }
      return;
    }
    const embed = buildOfficialEmbed(source);
    const ok = await showFrame(embed.url, embed.origin, source);
    if (!ok) throw new Error("The official player did not load in time.");
    const fallback = getOfficialSourceFallback(source);
    if (ui.fallback && fallback) {
      ui.fallback.href = fallback;
      ui.fallback.textContent = "Open original source";
      ui.fallback.hidden = false;
    }
  } catch (error) {
    const next = sources.find(item => item.sourceId !== source.sourceId);
    if (next) {
      setState("Trying another authorized source", "The selected source is unavailable. Vivid is checking the next verified source.");
      await activateSource(title, next, sources.filter(item => item.sourceId !== source.sourceId));
      return;
    }
    setState("Source unavailable", error instanceof Error ? error.message : "The source could not be opened.", "UNAVAILABLE");
    if (ui.fallback) ui.fallback.hidden = true;
  }
}

async function loadTitle() {
  if (!titleId || !/^[a-z0-9][a-z0-9-]{1,79}$/i.test(titleId)) {
    setState("Choose an African Stories title", "Open a published title from the African Stories catalogue to check its viewing access.", "NO TITLE");
    return;
  }
  try {
    const response = await fetch(CATALOGUE_URL, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("The African Stories catalogue is temporarily unavailable.");
    const catalogue = await response.json();
    if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.titles)) throw new Error("The African Stories catalogue has an unsupported format.");
    const title = catalogue.titles.find(item => item?.id === titleId && item.published === true);
    if (!title) {
      setState("Title not published", "This title is not in the currently published African Stories catalogue.", "NOT PUBLISHED");
      return;
    }
    if (ui.title) ui.title.textContent = title.title || "African Stories";
    if (ui.description) ui.description.textContent = title.synopsis || "African cinema, documentary and moving-image heritage.";
    const evidencePanel = document.getElementById("african-title-evidence");
    const metadata = document.getElementById("african-player-metadata");
    const access = document.getElementById("african-player-access");
    const references = document.getElementById("african-player-references");
    if (evidencePanel && metadata && access && references) {
      evidencePanel.hidden = false;
      metadata.textContent = [title.year, title.director, title.countryName, title.format,
        ...(Array.isArray(title.languages) ? title.languages : [])].filter(Boolean).join(" · ");
      access.textContent = "Access status: " + accessLabel(title.accessState) +
        ". This record is for discovery and research; it does not grant streaming or reproduction rights.";
      references.replaceChildren();
      const sourceRecords = [
        ...(title.provenance?.sourceUrl ? [{ label: "Primary catalogue / provenance record", url: title.provenance.sourceUrl }] : []),
        ...(Array.isArray(title.references) ? title.references : [])
      ];
      for (const source of sourceRecords) {
        try {
          const url = new URL(source.url);
          if (url.protocol !== "https:") continue;
          const link = document.createElement("a");
          link.href = url.toString();
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = source.label || "Open research source";
          references.append(link);
        } catch {}
      }
    }
    const sources = getPlayableAfricanSources(title);
    if (!sources.length) {
      setState("Viewing access not confirmed", getAfricanAccessMessage(title) + " No source has passed the rights, territory and authorization checks.", "ACCESS NOT CLEARED");
      return;
    }
    renderSourceButtons(sources, sources[0].sourceId, source => activateSource(title, source, sources));
    await activateSource(title, sources[0], sources);
  } catch (error) {
    setState("African Stories is temporarily unavailable", error instanceof Error ? error.message : "The catalogue could not be checked.", "CATALOGUE ERROR");
  }
}

function renderFilmFlux(items) {
  if (!ui.filmFluxPanel || !ui.filmFluxList) return;
  ui.filmFluxPanel.hidden = false;
  ui.filmFluxList.replaceChildren();
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "african-filmflux-card";
    if (item.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = item.thumbnailUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      card.append(image);
    }
    const body = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = item.title;
    const description = document.createElement("p");
    description.textContent = [item.channel, item.duration].filter(Boolean).join(" · ") || "FilmFlux discovery lead";
    const actions = document.createElement("div");
    actions.className = "african-filmflux-actions";
    if (item.youtubeId) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "african-source-button";
      play.textContent = "Open official YouTube player";
      play.addEventListener("click", () => {
        const url = new URL("https://www.youtube-nocookie.com/embed/" + item.youtubeId);
        url.searchParams.set("playsinline", "1");
        ui.frame.src = url.toString();
        ui.frame.hidden = false;
        ui.video.hidden = true;
        ui.state.hidden = true;
        if (ui.sourceLabel) ui.sourceLabel.textContent = "THIRD-PARTY DISCOVERY";
      });
      actions.append(play);
    }
    const sourceLink = document.createElement("a");
    sourceLink.href = item.filmUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "FilmFlux listing ↗";
    actions.append(sourceLink);
    body.append(heading, description, actions);
    card.append(body);
    ui.filmFluxList.append(card);
  }
}

async function loadFilmFlux() {
  if (!ui.filmFluxPanel) return;
  try {
    const items = await fetchFilmFluxTrending();
    renderFilmFlux(items);
    if (ui.filmFluxStatus) ui.filmFluxStatus.textContent = items.length ? "Discovery leads from FilmFlux. These are not Vivid-licensed streams." : "No discovery leads are available right now.";
  } catch (error) {
    if (ui.filmFluxStatus) ui.filmFluxStatus.textContent = error instanceof Error ? error.message : "Film discovery is temporarily unavailable.";
  }
}

if (ui.state && ui.frame && ui.video) {
  loadTitle();
  loadFilmFlux();
}
