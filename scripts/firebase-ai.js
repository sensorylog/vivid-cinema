import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { app, appCheckError, appCheckSkippedReason } from "./firebase.js";

let modelPromise = null;

function getRecallModel() {
  if (!modelPromise) {
    modelPromise = Promise.resolve().then(() => {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      return getGenerativeModel(ai, {
        model: "gemini-3.8-flash",
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 300
        }
      });
    }).catch(error => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
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

export async function getRecallClues(query, fallbackClues = []) {
  const cleanQuery = String(query || "").trim().slice(0, 1200);
  const fallback = [...new Set((Array.isArray(fallbackClues) ? fallbackClues : [])
    .map(value => String(value || "").trim()).filter(Boolean))].slice(0, 12);
  if (cleanQuery.length < 8) {
    return { clues: fallback, available: false, message: "The description is too short for AI clue extraction." };
  }
  if (appCheckSkippedReason) {
    return {
      clues: fallback,
      available: false,
      message: "Gemini testing requires the deployed Hosting site because App Check is skipped on localhost."
    };
  }
  if (appCheckError) {
    return {
      clues: fallback,
      available: false,
      message: "Firebase App Check did not initialize; local clue extraction is still active."
    };
  }

  try {
    const model = await getRecallModel();
    const result = await Promise.race([
      model.generateContent(
        "You help identify movies and TV shows from a person's remembered plot. " +
        "Extract 5 to 10 short, distinctive clues from the description below. " +
        "Prefer concrete events, unusual objects, plot devices, setting, relationships, and memorable details. " +
        "Do not guess or invent the title. Avoid generic words. Return only a JSON array of strings. " +
        "Description: " + JSON.stringify(cleanQuery)
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini clue extraction timed out.")), 8000))
    ]);
    const responseText = result?.response?.text?.() || "";
    const aiClues = parseClues(responseText);
    if (!aiClues.length) {
      return { clues: fallback, available: false, message: "Gemini returned no usable plot clues; local matching is still active." };
    }
    return {
      clues: [...new Set([...aiClues, ...fallback])].slice(0, 12),
      available: true,
      message: "Gemini-enhanced plot clue extraction is active."
    };
  } catch (error) {
    console.warn("Vivid Recall AI unavailable; using local clue extraction.", {
      code: error?.code || null,
      message: error?.message || String(error)
    });
    return {
      clues: fallback,
      available: false,
      message: "Gemini is unavailable right now; local clue extraction is still active."
    };
  }
}

let chatModelPromise = null;

function getRecallChatModel() {
  if (!chatModelPromise) {
    chatModelPromise = Promise.resolve().then(() => {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      return getGenerativeModel(ai, {
        model: "gemini-3.8-flash",
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 900
        }
      });
    }).catch(error => {
      chatModelPromise = null;
      throw error;
    });
  }
  return chatModelPromise;
}

export async function sendRecallChatMessage(messages, mediaType = "all") {
  if (appCheckSkippedReason) {
    throw new Error("Gemini chat requires the deployed Hosting site because App Check is skipped on localhost.");
  }
  if (appCheckError) {
    throw new Error("Firebase App Check did not initialize. Local catalogue search is still available.");
  }
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
  ).join("\\n");
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
    "Conversation so far:\\n" + transcript
  ].join("\\n");

  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini chat timed out. Please try again.")), 20000))
  ]);
  let payload;
  try {
    payload = JSON.parse(result?.response?.text?.() || "{}");
  } catch {
    throw new Error("Gemini returned an unreadable chat response. Please try again.");
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
  if (!reply) throw new Error("Gemini returned an empty reply. Please try again.");
  return { reply, candidates, model: "Gemini 3.8 Flash" };
}
