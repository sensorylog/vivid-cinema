import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { app } from "./firebase.js";

let modelPromise = null;

function getRecallModel() {
  if (!modelPromise) {
    modelPromise = Promise.resolve().then(() => {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      return getGenerativeModel(ai, {
        model: "gemini-3.8-flash",
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
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
