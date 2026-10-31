import { createInternetArchiveProvider } from "./internet-archive.js";

export const VIVID_DOWNLOADS = createInternetArchiveProvider();
if (typeof globalThis !== "undefined") globalThis.VIVID_DOWNLOADS = VIVID_DOWNLOADS;
