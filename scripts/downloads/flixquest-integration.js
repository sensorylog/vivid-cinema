import { createFlixQuestApi } from "./flixquest-api.js";

const STORAGE_KEY = "vivid:flixquest-api-url";
function readBaseUrl() {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}
export function saveFlixQuestBaseUrl(value) {
  const clean = String(value || "").trim();
  if (!clean) throw new TypeError("Enter your FlixQuest API URL.");
  const api = createFlixQuestApi({ baseUrl: clean });
  try { localStorage.setItem(STORAGE_KEY, clean); } catch { throw new Error("This browser cannot save the FlixQuest setting."); }
  return api;
}
export function getFlixQuestBaseUrl() { return readBaseUrl(); }
function api() {
  const baseUrl = readBaseUrl();
  if (!baseUrl) throw new Error("Connect your FlixQuest API instance in the Offline Downloads settings first.");
  return createFlixQuestApi({ baseUrl });
}
export const VIVID_DOWNLOADS = Object.freeze({
  sourceId: "flixquest",
  getBaseUrl: getFlixQuestBaseUrl,
  saveBaseUrl: saveFlixQuestBaseUrl,
  getAllowedHosts() {
    const baseUrl = readBaseUrl();
    if (!baseUrl) return [];
    try { return [new URL(baseUrl).hostname]; } catch { return []; }
  },
  async testConnection() {
    const providers = await api().getProviders();
    return { providers, count: providers.length };
  },
  async getOptions(media) {
    const client = api();
    const options = await client.getDownloadOptions(media);
    return Promise.all(options.map(async option => {
      let sizeLabel = "";
      if (option.sizeToken) {
        try {
          const estimate = await client.getStreamSize(option.sizeToken);
          const bytes = Number(estimate.estimatedBytes);
          if (Number.isFinite(bytes) && bytes > 0) {
            const units = ["B", "KB", "MB", "GB", "TB"], unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
            sizeLabel = "~" + (bytes / Math.pow(1024, unit)).toFixed(unit ? 1 : 0) + " " + units[unit];
          }
        } catch { /* A failed estimate must not hide a valid stream option. */ }
      }
      return { ...option, format: option.format.toUpperCase(), sizeLabel };
    }));
  },
  async resolve(job) {
    const media = job?.media || {};
    return api().resolveDownload(media, media.source_file);
  },
  async estimateSize(token) {
    return api().getStreamSize(token);
  }
});
if (typeof globalThis !== "undefined") globalThis.VIVID_DOWNLOADS = VIVID_DOWNLOADS;
