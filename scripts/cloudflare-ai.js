import { getIdToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { auth } from "./firebase.js";

const WORKERS_AI_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
const CLUE_TIMEOUT_MS = 10000;
const CHAT_TIMEOUT_MS = typeof navigator !== "undefined" && /Electron\//i.test(navigator.userAgent) ? 12000 : 30000;

let authReadyPromise = null;

async function getRestoredSignedInUser() {
  if (auth.currentUser) return auth.currentUser;
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let settled = false;
      const finish = user => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(user || auth.currentUser || null);
      };
      const timeout = setTimeout(() => finish(auth.currentUser), 8000);
      unsubscribe = onAuthStateChanged(auth, finish, error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    }).finally(() => { authReadyPromise = null; });
  }
  return authReadyPromise;
}

let modelPromise = null;
let aiRequestTail = Promise.resolve();
const CLUE_CACHE_KEY = "vivid:recall-clues:v1";
const CLUE_CACHE_TTL = 12 * 60 * 60 * 1000;

function readClueCache(key) {
  try {
    const cache = JSON.parse(localStorage.getItem(CLUE_CACHE_KEY) || "{}");
    const entry = cache[key];
    if (!entry || Date.now() - Number(entry.at || 0) > CLUE_CACHE_TTL || !Array.isArray(entry.clues)) return null;
    return entry.clues.filter(value => typeof value === "string").slice(0, 10);
  } catch {
    return null;
  }
}

function writeClueCache(key, clues) {
  try {
    const cache = JSON.parse(localStorage.getItem(CLUE_CACHE_KEY) || "{}");
    cache[key] = { at: Date.now(), clues: clues.slice(0, 10) };
    const entries = Object.entries(cache)
      .filter(([, entry]) => Date.now() - Number(entry?.at || 0) <= CLUE_CACHE_TTL)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, 40);
    localStorage.setItem(CLUE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

// Serialize explicit Recall requests so a user cannot accidentally burst
// several model calls at once. A failed request never poisons the queue.
function serializeAiRequest(task) {
  const current = aiRequestTail.then(task, task);
  aiRequestTail = current.then(() => undefined, () => undefined);
  return current;
}

function createRecallModel(maxOutputTokens) {
  // All model inference runs on Cloudflare Workers AI. The browser sends only
  // the signed-in user's Firebase ID token; no provider API key is exposed.
  return {
    async generateContent(prompt, options = {}) {
      const user = await getRestoredSignedInUser();
      if (!user || user.isAnonymous) {
        const error = new Error("Sign in to your Vivid account before using Vivid AI.");
        error.code = "auth/unauthenticated";
        throw error;
      }
      const requestBody = JSON.stringify({ prompt, maxOutputTokens });
      const send = async forceRefresh => {
        const idToken = await getIdToken(user, forceRefresh);
        return fetch("/api/ai", {
          method: "POST",
          headers: { "Authorization": "Bearer " + idToken, "Content-Type": "application/json" },
          cache: "no-store",
          signal: options.signal,
          body: requestBody
        });
      };
      let response = await send(false);
      // Firebase may restore a signed-in user before its cached ID token has
      // been refreshed. If the server rejects that token, refresh it once and
      // retry the same request without asking the user to sign in again.
      if (response.status === 401) {
        response = await send(true);
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        const error = new Error(payload.message || "Vivid AI request failed (" + response.status + ").");
        error.code = response.status === 401 ? "auth/unauthenticated" :
          response.status === 429 ? "resource-exhausted" : "functions/" + (payload.code || "internal");
        error.status = response.status;
        error.customData = { serverResponse: payload };
        throw error;
      }
      return { response: { text: () => payload.text || "" }, model: payload.model || WORKERS_AI_MODEL };
    }
  };
}

function getRecallModel() {
  if (!modelPromise) {
    modelPromise = Promise.resolve().then(() => createRecallModel(220)).catch(error => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

function parseJsonPayload(raw) {
  const text = String(raw || "").trim()
    .replace(/^\x60{3}(?:json)?\s*/i, "")
    .replace(/\s*\x60{3}$/i, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("The AI response was not valid JSON.");
  }
}

function parseClues(raw) {
  const text = String(raw || "").trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed
    .filter(value => typeof value === "string")
    .map(value => value.trim().replace(/\s+/g, " ").slice(0, 90))
    .filter(value => value.length >= 3 && value.length <= 90))]
    .slice(0, 10);
}

async function generateWithTimeout(model, prompt, timeoutMs, operation) {
  return serializeAiRequest(async () => {
    const controller = new AbortController();
    let timeoutId;
    try {
      return await Promise.race([
        model.generateContent(prompt, { signal: controller.signal }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error = new Error(
              operation + " timed out after " + Math.round(timeoutMs / 1000) +
              " seconds; cancellation of the request was attempted."
            );
            error.name = "TimeoutError";
            reject(error);
            controller.abort();
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

export async function getRecallClues(query, fallbackClues = []) {
  const cleanQuery = String(query || "").trim().slice(0, 1200);
  const fallback = [...new Set((Array.isArray(fallbackClues) ? fallbackClues : [])
    .map(value => String(value || "").trim()).filter(Boolean))].slice(0, 12);
  if (cleanQuery.length < 8) {
    return { clues: fallback, available: false, message: "The description is too short for AI clue extraction." };
  }
  const cacheKey = cleanQuery.toLowerCase().replace(/\\s+/g, " ").slice(0, 1200);
  const cachedClues = readClueCache(cacheKey);
  if (cachedClues?.length) {
    return { clues: [...new Set([...cachedClues, ...fallback])].slice(0, 12), available: true, message: "Cached Vivid Recall clues are active." };
  }
  try {
    const model = await getRecallModel();
    const result = await generateWithTimeout(
      model,
      "You help identify movies and TV shows from a person's remembered plot. " +
      "Extract 5 to 10 short, distinctive clues from the description below. " +
      "Prefer concrete events, unusual objects, plot devices, setting, relationships, and memorable details. " +
      "Do not guess or invent the title. Avoid generic words. Return only a JSON array of strings. " +
      "Description: " + JSON.stringify(cleanQuery),
      CLUE_TIMEOUT_MS,
      "Cloudflare Workers AI clue extraction"
    );
    const responseText = result?.response?.text?.() || "";
    const aiClues = parseClues(responseText);
    if (!aiClues.length) {
      return { clues: fallback, available: false, message: "Cloudflare Workers AI returned no usable plot clues; local matching is still active." };
    }
    writeClueCache(cacheKey, aiClues);
    return {
      clues: [...new Set([...aiClues, ...fallback])].slice(0, 12),
      available: true,
      message: "Cloudflare Workers AI clue extraction is active."
    };
  } catch (error) {
    console.warn("Vivid Recall AI unavailable; using local clue extraction.", {
      code: error?.code || null,
      message: error?.message || String(error),
      customData: error?.customData || null,
      details: error?.details || null
    });
    return {
      clues: fallback,
      available: false,
      message: "Cloudflare Workers AI is unavailable right now; local clue extraction is still active."
    };
  }
}

let chatModelPromise = null;

function getRecallChatModel() {
  if (!chatModelPromise) {
    chatModelPromise = Promise.resolve().then(() => createRecallModel(320)).catch(error => {
      chatModelPromise = null;
      throw error;
    });
  }
  return chatModelPromise;
}

export async function sendRecallChatMessage(messages, mediaType = "all") {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter(item => item && ["user", "assistant"].includes(item.role))
    .slice(-8)
    .map(item => ({
      role: item.role,
      content: String(item.content || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 700)
    }))
    .filter(item => item.content);
  if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
    throw new Error("Enter a message to start the conversation.");
  }

  const model = await getRecallChatModel();
  const transcript = safeMessages.map(item =>
    (item.role === "user" ? "USER" : "VIVID RECALL") + ": " + item.content
  ).join("\n");
  const prompt = [
    "You are Vivid Recall, a warm, natural conversational movie and TV memory detective.",
    "Your primary job is to chat naturally with a user trying to identify a movie or TV show they half remember.",
    "Respond to their actual question. Ask one useful follow-up question when the memory is vague.",
    "When there are enough clues, suggest up to 5 plausible real titles and explain briefly why each might fit.",
    "Never claim a title is verified. The app separately checks suggested titles against TMDB.",
    "Do not invent plot details. It is fine to say you are uncertain.",
    "The user is looking for: " + (["movie", "tv"].includes(mediaType) ? mediaType === "tv" ? "TV series" : "movies" : "movies or TV series") + ".",
    "Return only a JSON object with string field reply and array field candidates.",
    "Each candidates item must contain title, mediaType (movie, tv, or all), and reason (short string).",
    "Keep the reply concise and use no more than 5 candidates.",
    "Conversation so far:\n" + transcript
  ].join("\n");

  const result = await generateWithTimeout(model, prompt, CHAT_TIMEOUT_MS, "Cloudflare Workers AI chat");
  let payload;
  try {
    payload = parseJsonPayload(result?.response?.text?.() || "{}");
  } catch {
    throw new Error("Cloudflare Workers AI returned an unreadable chat response. Please try again.");
  }
  const reply = String(payload?.reply || "").trim().slice(0, 900);
  const candidates = (Array.isArray(payload?.candidates) ? payload.candidates : [])
    .filter(item => item && typeof item.title === "string")
    .slice(0, 5)
    .map(item => ({
      title: String(item.title).trim().slice(0, 120),
      mediaType: ["movie", "tv"].includes(item.mediaType) ? item.mediaType : "all",
      reason: String(item.reason || "").trim().slice(0, 180)
    }))
    .filter(item => item.title);
  if (!reply) throw new Error("Cloudflare Workers AI returned an empty reply. Please try again.");
  return { reply, candidates, model: "Cloudflare Workers AI · Granite 4.0 H Micro" };
}
