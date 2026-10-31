const API = "https://archive.org";
const VIDEO_EXT = /\.(?:mp4|m4v|webm|mov|ogv)$/i;
const APPROVED_LICENSES = [
  /creativecommons\.org\/publicdomain\/zero\/1\.0\/?(?:$|[?#])/i,
  /creativecommons\.org\/publicdomain\/mark\/1\.0\/?(?:$|[?#])/i,
  /creativecommons\.org\/licenses\/by\/4\.[0-9]+\/?(?:$|[?#])/i,
  /creativecommons\.org\/licenses\/by-sa\/4\.[0-9]+\/?(?:$|[?#])/i
];

function safeText(value, limit = 500) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
function itemId(value) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(id)) throw new TypeError("Invalid Internet Archive item identifier.");
  return id;
}
function approvedRights(metadata) {
  const license = String(metadata?.metadata?.licenseurl || "");
  const rights = safeText(metadata?.metadata?.rights || "", 2000).toLowerCase();
  return APPROVED_LICENSES.some(pattern => pattern.test(license)) ||
    /public domain|dedicated to the public domain|cc0 1\.0/.test(rights);
}
function videoFiles(metadata) {
  return (Array.isArray(metadata?.files) ? metadata.files : [])
    .filter(file => file && typeof file.name === "string" && VIDEO_EXT.test(file.name) &&
      file.source !== "metadata" && file.private !== "true" && Number(file.size) > 0)
    .map(file => ({
      name: file.name,
      size: Number(file.size),
      format: safeText(file.format || "Video", 80)
    }))
    .filter(file => Number.isSafeInteger(file.size) && file.size > 0)
    .sort((a, b) => a.size - b.size);
}
export function createInternetArchiveSource({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  async function json(url, signal) {
    const response = await fetchImpl(url, { method: "GET", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal });
    if (!response?.ok || response.redirected) throw new Error("Internet Archive could not provide the requested catalogue data.");
    return response.json();
  }
  return Object.freeze({
    async search(query, { signal, rows = 12 } = {}) {
      const term = safeText(query, 100);
      if (term.length < 2) return [];
      const params = new URLSearchParams({
        q: term + " AND mediatype:movies",
        "fl[]": "identifier,title,year,creator",
        rows: String(Math.max(1, Math.min(20, Number(rows) || 12))),
        page: "1",
        output: "json"
      });
      const data = await json(API + "/advancedsearch.php?" + params.toString(), signal);
      return (data?.response?.docs || []).filter(doc => doc && typeof doc.identifier === "string")
        .map(doc => ({
          identifier: itemId(doc.identifier),
          title: safeText(doc.title || doc.identifier, 180),
          year: safeText(doc.year, 8),
          creator: safeText(doc.creator, 120),
          detailUrl: "https://archive.org/details/" + encodeURIComponent(doc.identifier)
        }));
    },
    async getItem(identifier, { signal } = {}) {
      const id = itemId(identifier);
      const metadata = await json(API + "/metadata/" + encodeURIComponent(id), signal);
      if (metadata?.error || !metadata?.metadata) throw new Error("This Internet Archive item has no readable metadata.");
      const files = videoFiles(metadata);
      const permitted = approvedRights(metadata);
      const d1 = String(metadata.d1 || "");
      const d2 = String(metadata.d2 || "");
      const dir = String(metadata.dir || "");
      const host = [d1, d2].find(value => /^[a-z0-9.-]+\.archive\.org$/i.test(value));
      const safeDir = /^\/[0-9]+\/items\/[A-Za-z0-9_-]{5,80}$/.test(dir) ? dir : "";
      return {
        identifier: id,
        title: safeText(metadata.metadata.title || id, 180),
        year: safeText(metadata.metadata.year || metadata.metadata.date, 8),
        creator: safeText(metadata.metadata.creator, 120),
        description: safeText(metadata.metadata.description, 1000),
        licenseUrl: String(metadata.metadata.licenseurl || ""),
        rights: safeText(metadata.metadata.rights, 500),
        rightsApproved: permitted,
        detailUrl: "https://archive.org/details/" + encodeURIComponent(id),
        files: permitted && host && safeDir ? files.map(file => ({
          ...file,
          url: "https://" + host + safeDir + "/" + file.name.split("/").map(encodeURIComponent).join("/")
        })) : []
      };
    },
    async resolve(job, { signal } = {}) {
      const identifier = job?.media?.source_id;
      const selectedName = job?.media?.source_file;
      if (!identifier || !selectedName) throw new Error("The selected Archive.org file is missing from this download job.");
      const item = await this.getItem(identifier, { signal });
      if (!item.rightsApproved) throw new Error("This item does not declare an approved public-domain or Creative Commons license.");
      const file = item.files.find(entry => entry.name === selectedName);
      if (!file) throw new Error("That video file is no longer available or is not eligible for download.");
      const url = new URL(file.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".archive.org")) throw new Error("Internet Archive returned an unexpected file host.");
      const extension = VIDEO_EXT.exec(file.name)?.[0].slice(1).toLowerCase();
      const mimeType = extension === "m4v" ? "video/mp4" : extension === "ogv" ? "video/ogg" : extension === "mov" ? "video/quicktime" : "video/" + extension;
      return { url: url.href, mimeType, allowedHost: url.hostname };
    }
  });
}
