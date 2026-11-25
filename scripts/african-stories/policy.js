const ACCESS_STATES = new Set(["stream_on_vivid", "watch_officially"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

export function isGrantCurrent(grant, { territory = "" , now = Date.now() } = {}) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return false;
  if (grant.status !== "verified" || !nonEmpty(grant.rightsHolder) ||
      !nonEmpty(grant.basis) || !nonEmpty(grant.evidenceRef)) return false;
  if (!Array.isArray(grant.territories) || grant.territories.length === 0 ||
      !grant.territories.every(code => typeof code === "string" && /^[A-Z]{2}$/.test(code) || code === "*")) return false;
  if (!grant.territories.includes("*") && (!territory || !grant.territories.includes(territory.toUpperCase()))) return false;
  if (grant.startsAt && (!validDate(grant.startsAt) || Date.parse(grant.startsAt) > now)) return false;
  if (!validDate(grant.expiresAt) || Date.parse(grant.expiresAt) <= now) return false;
  return true;
}

export function isAfricanSourcePlayable(title, source, options = {}) {
  if (!title || typeof title !== "object" || !ACCESS_STATES.has(title.accessState)) return false;
  if (title.published !== true || !nonEmpty(title.id) || !nonEmpty(title.editionId)) return false;
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  if (source.enabled !== true || source.authorized !== true || source.status !== "active") return false;
  if (!nonEmpty(source.sourceId) || !["youtube", "vimeo", "peertube", "archive", "partner"].includes(source.provider)) return false;
  if (source.authorization?.status !== "verified" ||
      !nonEmpty(source.authorization.evidenceRef) ||
      !nonEmpty(source.authorization.authorizedBy)) return false;
  if (!isGrantCurrent(title.rightsGrant, options)) return false;
  if (source.expiresAt && (!validDate(source.expiresAt) || Date.parse(source.expiresAt) <= (options.now ?? Date.now()))) return false;
  return true;
}

export function getPlayableAfricanSources(title, options = {}) {
  if (!Array.isArray(title?.sources)) return [];
  return title.sources.filter(source => isAfricanSourcePlayable(title, source, options))
    .sort((a, b) => (Number(a.priority) || 100) - (Number(b.priority) || 100));
}

export function getAfricanAccessMessage(title) {
  switch (title?.accessState) {
    case "stream_on_vivid": return "Checking Vivid-authorized playback sources.";
    case "watch_officially": return "Checking verified official viewing destinations.";
    case "discover_archive_record": return "This title is catalogued, but no public viewing route is confirmed.";
    case "access_pending": return "Viewing access is still being verified. No stream is available yet.";
    default: return "This title has no published viewing permission.";
  }
}
