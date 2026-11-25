export function filterAfricanCountries(countries, { region = "", query = "" } = {}) {
  const normalized = String(query).trim().toLocaleLowerCase();
  return (Array.isArray(countries) ? countries : []).filter(country => {
    if (region && country.regionId !== region) return false;
    if (!normalized) return true;
    return [country.name, country.code, country.regionId].some(value =>
      String(value || "").toLocaleLowerCase().includes(normalized)
    );
  });
}

export function filterAfricanTitles(titles, { country = "", query = "", format = "", language = "" } = {}) {
  const normalized = String(query).trim().toLocaleLowerCase();
  return (Array.isArray(titles) ? titles : []).filter(title => {
    if (country && title.countryCode !== country) return false;
    if (format && title.format !== format) return false;
    if (language && !(Array.isArray(title.languages) && title.languages.includes(language))) return false;
    if (!normalized) return true;
    return [title.title, title.synopsis, title.countryName, title.historicalPeriod,
      ...(Array.isArray(title.languages) ? title.languages : []),
      ...(Array.isArray(title.themes) ? title.themes : [])]
      .some(value => String(value || "").toLocaleLowerCase().includes(normalized));
  });
}

export function accessLabel(state) {
  return ({
    stream_on_vivid: "Stream on Vivid",
    watch_officially: "Watch officially",
    discover_archive_record: "Discover / archive record",
    access_pending: "Access pending"
  })[state] || "Access not verified";
}

function hasEvidenceReference(references) {
  return Array.isArray(references) && references.some(reference => {
    try {
      const url = new URL(reference.url);
      return url.protocol === "https:" && typeof reference.label === "string" && reference.label.trim().length > 0;
    } catch { return false; }
  });
}

export function validEditorialRecord(record) {
  return !!record && typeof record === "object" && record.published === true &&
    typeof record.id === "string" && record.id.length > 1 &&
    typeof record.title === "string" && record.title.trim().length > 0 &&
    typeof record.summary === "string" && record.summary.trim().length > 0 &&
    typeof record.evidenceRef === "string" && record.evidenceRef.trim().length > 0 &&
    hasEvidenceReference(record.references);
}

export function validAfricanTitleRecord(title) {
  if (!title || typeof title !== "object" || title.published !== true) return false;
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/i.test(title.id || "") ||
      typeof title.editionId !== "string" || title.editionId.length < 2 ||
      typeof title.title !== "string" || !title.title.trim() ||
      typeof title.synopsis !== "string" || !title.synopsis.trim() ||
      !/^[A-Z]{2}$/.test(title.countryCode || "")) return false;
  if (!["feature", "documentary", "oral_history", "newsreel", "archive_footage", "historical_drama"].includes(title.format)) return false;
  if (!["stream_on_vivid", "watch_officially", "discover_archive_record", "access_pending"].includes(title.accessState)) return false;
  if (typeof title.provenance?.evidenceRef !== "string" || !title.provenance.evidenceRef.trim()) return false;
  try {
    if (new URL(title.provenance.sourceUrl).protocol !== "https:") return false;
  } catch { return false; }
  if (title.editorialReview?.status !== "approved" || typeof title.editorialReview.reviewedAt !== "string" ||
      !Number.isFinite(Date.parse(title.editorialReview.reviewedAt))) return false;
  return true;
}
