import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const history = [];
let busy = false;
let requestVersion = 0;

function cleanText(value, max = 900) {
  return String(value ?? "").replace(/[\\u0000-\\u001f]/g, " ").trim().slice(0, max);
}

function addMessage(role, text, extra = "") {
  const list = $("recall-chat-messages");
  if (!list) return null;
  const item = document.createElement("article");
  item.className = "recall-chat-message " + (role === "assistant" ? "is-assistant" : "is-user");
  item.innerHTML = `
    <div class="recall-chat-avatar" aria-hidden="true">${role === "assistant" ? "V" : "YOU"}</div>
    <div class="recall-chat-bubble">
      <div class="recall-chat-role">${role === "assistant" ? "Vivid Recall" : "You"}</div>
      <p>${escapeHtml(text)}</p>
      ${extra}
    </div>`;
  list.append(item);
  list.scrollTop = list.scrollHeight;
  return item;
}

function setBusy(value) {
  busy = value;
  const send = $("recall-chat-send");
  const input = $("recall-chat-input");
  if (send) {
    send.disabled = value;
    send.innerHTML = value
      ? '<span class="recall-chat-spinner" aria-hidden="true"></span> Thinking'
      : 'Send <i class="bi bi-arrow-up-right" aria-hidden="true"></i>';
  }
  if (input) input.disabled = value;
  if (value) setStatus("Gemini is thinking through your clues…");
}

function setStatus(text) {
  const status = $("recall-chat-status");
  if (status) status.textContent = text;
}

function normalizeTitle(value) {
  return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mediaTitle(item) {
  return String(item?.title || item?.name || "");
}

function exactTitleMatch(candidate, result) {
  const wanted = normalizeTitle(candidate.title);
  const found = normalizeTitle(mediaTitle(result));
  if (!wanted || !found) return false;
  return wanted === found || found.startsWith(wanted + " ") || wanted.startsWith(found + " ");
}

async function verifyCandidates(candidates, version) {
  const verified = [];
  for (const candidate of (Array.isArray(candidates) ? candidates : []).slice(0, 5)) {
    const title = cleanText(candidate?.title, 120);
    const type = ["movie", "tv"].includes(candidate?.mediaType) ? candidate.mediaType : "all";
    if (!title) continue;
    try {
      const data = type === "movie"
        ? await tmdbApi.searchMovies(title)
        : type === "tv"
          ? await tmdbApi.searchTv(title)
          : await tmdbApi.searchMulti(title);
      if (version !== requestVersion) return [];
      const results = (data?.results || []).filter(item => {
        const actualType = item.media_type || (item.first_air_date ? "tv" : item.release_date ? "movie" : item.title ? "movie" : "unknown");
        const requested = $("recall-chat-type")?.value || "all";
        return ["movie", "tv"].includes(actualType) &&
          (type === "all" || actualType === type) &&
          (requested === "all" || actualType === requested) &&
          exactTitleMatch({ title }, item);
      });
      const result = results[0];
      if (result) {
        const actualType = result.media_type || (result.first_air_date ? "tv" : "movie");
        if (!verified.some(item => String(item.id) === String(result.id) && item.media_type === actualType)) {
          verified.push({ ...result, media_type: actualType, recallReason: cleanText(candidate.reason, 140) });
        }
      }
    } catch {
      // One failed title lookup should not stop other catalogue checks.
    }
  }
  return verified;
}

function renderVerifiedCards(items) {
  if (!items.length) return "";
  const cards = items.map(item => {
    const title = mediaTitle(item);
    const year = String(item.release_date || item.first_air_date || "").slice(0, 4);
    const type = item.media_type === "tv" ? "TV series" : "Movie";
    const overview = cleanText(item.overview, 180);
    const reason = cleanText(item.recallReason, 140);
    return `
      <a class="recall-chat-result" href="${escapeHtml(getMediaUrl(item))}">
        <img src="${escapeHtml(getImageUrl(item.poster_path, "w185"))}" alt="" loading="lazy">
        <span class="recall-chat-result-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml([type, year].filter(Boolean).join(" · "))}</span>
          ${reason ? `<small>${escapeHtml(reason)}</small>` : overview ? `<small>${escapeHtml(overview)}</small>` : ""}
        </span>
        <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
      </a>`;
  }).join("");
  return `<div class="recall-chat-results"><div class="recall-chat-results-label">TMDB-verified matches</div>${cards}</div>`;
}

function fallbackToLocalSearch(version) {
  if (version !== requestVersion) return;
  const search = $("intent-query");
  const form = $("intent-form");
  const memory = history.filter(item => item.role === "user").map(item => item.content).join(" ");
  if (search && form && memory) {
    search.value = memory.slice(0, 500);
    setStatus("Gemini unavailable · running local Recall search");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

async function sendMessage(text) {
  const userText = cleanText(text, 700);
  if (!userText || busy) return;
  const input = $("recall-chat-input");
  if (input) input.value = "";
  history.push({ role: "user", content: userText });
  addMessage("user", userText);
  setBusy(true);
  const version = ++requestVersion;

  try {
    const { sendRecallChatMessage } = await import("./firebase-ai.js");
    const payload = await sendRecallChatMessage(
      history.slice(-8).map(item => ({ role: item.role, content: item.content })),
      $("recall-chat-type")?.value || "all"
    );
    if (version !== requestVersion) return;
    const reply = cleanText(payload?.reply, 900) || "I’m following your clues. What is one more detail you remember?";
    history.push({ role: "assistant", content: reply });
    const verified = await verifyCandidates(payload?.candidates, version);
    if (version !== requestVersion) return;
    addMessage("assistant", reply, renderVerifiedCards(verified));
    if (verified.length) setStatus("Checked " + verified.length + " title" + (verified.length === 1 ? "" : "s") + " against TMDB · Ask another question to narrow it down.");
    else if (Array.isArray(payload?.candidates) && payload.candidates.length) setStatus("No exact catalogue match yet · add another clue or correct a guess.");
    else setStatus("Gemini chat is active · Ask another question to narrow it down.");
  } catch (error) {
    if (version !== requestVersion) return;
    console.warn("Vivid Recall Gemini chat failed:", { code: error?.code || null, message: error?.message || String(error) });
    addMessage("assistant", "I couldn’t reach Gemini just now, bro. Your conversation is still here, and I’ll try the local catalogue matcher with the clues you’ve shared.");
    setStatus("AI chat unavailable · trying local Recall");
    fallbackToLocalSearch(version);
  } finally {
    if (version === requestVersion) {
      setBusy(false);
      if (input) input.focus({ preventScroll: true });
    }
  }
}

function init() {
  const form = $("recall-chat-form");
  const input = $("recall-chat-input");
  if (!form || !input) return;
  form.addEventListener("submit", event => {
    event.preventDefault();
    void sendMessage(input.value);
  });
  document.querySelectorAll("[data-recall-prompt]").forEach(button => {
    button.addEventListener("click", () => void sendMessage(button.dataset.recallPrompt || ""));
  });
  $("recall-chat-reset")?.addEventListener("click", () => {
    requestVersion += 1;
    history.length = 0;
    $("recall-chat-messages")?.replaceChildren();
    addMessage("assistant", "Hey, I’m Vivid Recall. Tell me anything you remember — a scene, a character, a strange object, the ending, or just the feeling of the story. We’ll work it out together.");
    setStatus("Gemini AI chat · TMDB title checks");
    setBusy(false);
    input.value = "";
    input.focus();
  });
  addMessage("assistant", "Hey, I’m Vivid Recall. Tell me anything you remember — a scene, a character, a strange object, the ending, or just the feeling of the story. We’ll work it out together.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
