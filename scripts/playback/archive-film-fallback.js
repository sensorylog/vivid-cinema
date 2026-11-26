const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata/";
const ACCEPTED_LICENSES = [
  /creativecommons\.org\/publicdomain\/(?:mark|zero)\//i,
  /creativecommons\.org\/licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0)\//i
];

function cleanText(value, max = 240) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function licenseFor(metadata) {
  const url = cleanText(metadata?.licenseurl, 500);
  const rights = cleanText(metadata?.rights, 500);
  const normalized = url.toLowerCase();
  if (normalized.includes("-nc/") || normalized.includes("-nd/")) return null;
  const match = ACCEPTED_LICENSES.find(pattern => pattern.test(url));
  if (match) {
    if (/publicdomain\/(?:mark|zero)\//i.test(url)) return "Public-domain declaration";
    return normalized.includes("by-sa/") ? "CC BY-SA · attribution/share-alike" : "CC BY · attribution";
  }
  if (/public domain|no known copyright restrictions/i.test(rights)) return "Public-domain claim";
  return null;
}

export function hasPlayableVideo(files) {
  return (Array.isArray(files) ? files : []).some(file => {
    const name = String(file?.name || "").toLowerCase();
    const format = String(file?.format || "").toLowerCase();
    return !file?.private && (/\.(mp4|m4v|webm|ogv)$/i.test(name) || /mpeg4|h\.264|webm|ogg video/.test(format));
  });
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Archive search returned HTTP " + response.status);
  return response.json();
}

export function mountArchiveFilmSearch({ root, title = "", year = "", onPlay }) {
  if (!root || root.dataset.archiveMounted === "true") return;
  root.dataset.archiveMounted = "true";
  const section = document.createElement("section");
  section.className = "vivid-archive-search";
  section.innerHTML = '<div class="vivid-archive-heading"><strong>Archive Cinema</strong><span>Classic films · public-domain & CC declarations</span></div><form class="vivid-archive-form"><label for="vivid-archive-query">Search the film archive</label><div class="vivid-archive-search-row"><input id="vivid-archive-query" name="q" type="search" maxlength="120" autocomplete="off" placeholder="Search classic films" required><button type="submit">Search</button></div></form><p class="vivid-archive-note">Only listings with an explicit public-domain or commercial Creative Commons declaration and a video file are offered. Archive uploader rights claims are not independently verified.</p><div class="vivid-archive-results" aria-live="polite"></div>';
  root.append(section);

  const form = section.querySelector("form");
  const input = section.querySelector("input");
  const results = section.querySelector(".vivid-archive-results");
  const submit = section.querySelector('button[type="submit"]');
  const defaultQuery = cleanText(title, 120);
  input.value = cleanText(defaultQuery, 120);

  const status = message => {
    results.replaceChildren();
    const node = document.createElement("p");
    node.className = "vivid-archive-status";
    node.textContent = message;
    results.append(node);
  };

  async function search(query) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    submit.disabled = true;
    status("Searching Internet Archive…");
    try {
      const params = new URLSearchParams({
        q: 'title:("' + query.replace(/["\\]/g, " ").trim() + '") AND mediatype:movies',
        output: "json",
        rows: "12",
        page: "1",
        "fl[]": "identifier,title,year,creator"
      });
      const data = await fetchJson(SEARCH_URL + "?" + params.toString(), controller.signal);
      const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
      if (!docs.length) {
        status("No archive matches found. Try an alternate title or remove the year.");
        return;
      }
      const candidates = await Promise.all(docs.slice(0, 10).map(async doc => {
        const identifier = String(doc?.identifier || "");
        if (!/^[a-z0-9._-]{1,180}$/i.test(identifier)) return null;
        try {
          const metadata = await fetchJson(METADATA_URL + encodeURIComponent(identifier), controller.signal);
          const license = licenseFor(metadata?.metadata || {});
          if (!license || !hasPlayableVideo(metadata?.files)) return null;
          return { identifier, title: cleanText(doc.title || metadata?.metadata?.title || identifier), year: cleanText(doc.year || metadata?.metadata?.year || ""), creator: cleanText(doc.creator || ""), license };
        } catch {
          return null;
        }
      }));
      const eligible = candidates.filter(Boolean);
      results.replaceChildren();
      if (!eligible.length) {
        status("Matches were found, but none had both a playable video file and an eligible rights declaration.");
        return;
      }
      const heading = document.createElement("p");
      heading.className = "vivid-archive-status";
      heading.textContent = eligible.length + " playable archive listing" + (eligible.length === 1 ? "" : "s") + " with declared rights";
      results.append(heading);
      for (const item of eligible) {
        const card = document.createElement("article");
        card.className = "vivid-archive-result";
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = item.title + (item.year ? " (" + item.year + ")" : "");
        const meta = document.createElement("small");
        meta.textContent = [item.creator, item.license].filter(Boolean).join(" · ");
        const sourceLink = document.createElement("a");
        sourceLink.href = "https://archive.org/details/" + encodeURIComponent(item.identifier);
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = "Source & rights";
        sourceLink.className = "vivid-archive-source-link";
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = "Play in Vivid";
        action.addEventListener("click", () => onPlay?.(item));
        details.append(name, meta);
        details.append(sourceLink);
        card.append(details, action);
        results.append(card);
      }
    } catch (error) {
      status(error?.name === "AbortError" ? "Search cancelled." : "Archive search is temporarily unavailable. Please try again.");
      console.warn("Vivid Archive Cinema search failed:", error);
    } finally {
      window.clearTimeout(timeoutId);
      submit.disabled = false;
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const query = cleanText(input.value, 120);
    if (query.length < 2) return status("Enter at least two characters to search.");
    void search(query);
  });
  if (defaultQuery.length >= 2) void search(defaultQuery);
}
