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

export function filterAfricanTitles(titles, { country = "", query = "", format = "" } = {}) {
  const normalized = String(query).trim().toLocaleLowerCase();
  return (Array.isArray(titles) ? titles : []).filter(title => {
    if (country && title.countryCode !== country) return false;
    if (format && title.format !== format) return false;
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

export function validEditorialRecord(record) {
  return !!record && typeof record === "object" && record.published === true &&
    typeof record.id === "string" && record.id.length > 1 &&
    typeof record.title === "string" && record.title.trim().length > 0 &&
    typeof record.summary === "string" && record.summary.trim().length > 0 &&
    typeof record.evidenceRef === "string" && record.evidenceRef.trim().length > 0;
}
