import { VIVID_CONFIG } from "./config.js";

const MAX_DESCRIPTION_LENGTH = 700;
const MAX_CLUES = 8;
const MAX_CANDIDATES = 8;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Optional second-provider fallback. The browser calls only our Worker URL;
 * the OpenRouter API key must remain a Cloudflare Worker secret.
 * Returns null when not configured, so Gemini/TMDB behavior is unchanged.
 */
export async function findOpenRouterPlotMatches(description = "", mediaType = "all") {
  const endpoint = String(VIVID_CONFIG.api.plotAiFallbackUrl || "").trim();
  const query = String(description || "").trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (!endpoint || query.length < 8) return null;

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw Object.assign(new Error("The secondary AI endpoint is not a valid URL."), { code: "openrouter/invalid-endpoint" });
  }
  if (url.protocol !== "https:") {
    throw Object.assign(new Error("The secondary AI endpoint must use HTTPS."), { code: "openrouter/insecure-endpoint" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        description: query,
        mediaType: ["movie", "tv"].includes(mediaType) ? mediaType : "all"
      })
    });
    if (!response.ok) {
      const error = new Error("Secondary AI request failed (" + response.status + ").");
      error.code = "openrouter/http-" + response.status;
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.clues) || !Array.isArray(data.candidates)) {
      throw Object.assign(new Error("Secondary AI returned an invalid response."), { code: "openrouter/invalid-response" });
    }

    const clues = [...new Set(data.clues
      .map(value => cleanText(value, 80))
      .filter(value => value.length >= 3))].slice(0, MAX_CLUES);
    const seen = new Set();
    const candidates = data.candidates.map(item => ({
      title: cleanText(item?.title, 120),
      mediaType: ["movie", "tv"].includes(item?.mediaType) ? item.mediaType : "unknown",
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      reason: cleanText(item?.reason, 140)
    })).filter(item => {
      if (!item.title) return false;
      const key = item.title.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return mediaType === "all" || item.mediaType === "unknown" || item.mediaType === mediaType;
    }).slice(0, MAX_CANDIDATES);

    return { clues, candidates };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("Secondary AI request timed out."), { code: "openrouter/timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
