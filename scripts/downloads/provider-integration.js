import { createInternetArchiveProvider } from "./internet-archive.js";
import { createWikimediaCommonsProvider } from "./wikimedia-commons.js";

const providers = new Map([
  ["internet-archive", createInternetArchiveProvider()],
  ["wikimedia-commons", createWikimediaCommonsProvider()]
]);
export const VIVID_DOWNLOADS = Object.freeze({
  sourceId: "automatic",
  async getOptions(media, context) {
    const results = await Promise.allSettled([...providers.values()].map(provider => provider.getOptions(media, context)));
    const successful = results.filter(result => result.status === "fulfilled");
    if (!successful.length) throw new Error("Could not reach either public video archive. Check your connection and try again.");
    return successful.flatMap(result => result.value)
      .sort((a, b) => (b.size || 0) - (a.size || 0));
  },
  async resolve(job, context) {
    const sourceId = String(job?.media?.source_id || "");
    const provider = providers.get(sourceId);
    if (!provider) throw new Error("The selected download source is no longer available. Search again.");
    return provider.resolve(job, context);
  }
});
if (typeof globalThis !== "undefined") globalThis.VIVID_DOWNLOADS = VIVID_DOWNLOADS;
