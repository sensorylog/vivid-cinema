import { VIVID_CONFIG } from "./config.js";
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const endpoint = () => String(VIVID_CONFIG.api.plotAiFallbackUrl || "").trim();
const history = [];
let busy = false;
let requestVersion = 0;

function cleanText(value, max = 900) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
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
  const status = $("recall-chat-status");
  if (send) {
    send.disabled = value;
    send.innerHTML = value
      ? '<span class="recall-chat-spinner" aria-hidden="true"></span> Thinking'
      : 'Send <i class="bi bi-arrow-up-right" aria-hidden="true"></i>';
  }
  if (input) input.disabled = value;
  if (status) status.textContent = value ? "Thinking through your clues…" : "";
}

function normalizeTitle(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mediaTitle(item) {
  return String(item?.title || item?.name || "");
}

function exactTitleMatch(candidate, result) {
  const wanted = normalizeTitle(candidate.title);
  const found = normalizeTitle(mediaTitle(result));
  if (!wanted || !found) return false;
  if (wanted === found) return true;
  return found.startsWith(wanted + " ") || wanted.startsWith(found + " ");
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
        return ["movie", "tv"].includes(actualType) &&
          (type === "all" || actualType === type) &&
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
      // A single failed title lookup should not prevent checking other candidates.
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
    return `
      <a class="recall-chat-result" href="${escapeHtml(getMediaUrl(item))}">
        <img src="${escapeHtml(getImageUrl(item.poster_path, "w185"))}" alt="" loading="lazy">
        <span class="recall-chat-result-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml([type, year].filter(Boolean).join(" · "))}</span>
          ${overview ? `<small>${escapeHtml(overview)}</small>` : ""}
        </span>
        <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
      </a>`;
  }).join("");
  return `<div class="recall-chat-results"><div class="recall-chat-results-label">TMDB-verified matches</div>${cards}</div>`;
}

function setStatus(text) {
  const status = $("recall-chat-status");
  if (status) status.textContent = text;
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
    if (!endpoint()) throw new Error("Vivid Recall AI chat has not been connected yet.");
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "chat",
        mediaType: $("recall-chat-type")?.value || "all",
        messages: history.slice(-6).map(item => ({ role: item.role, content: item.content.slice(0, 500) }))
      }),
      signal: AbortSignal.timeout(27000)
    });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? "AIRFORCE_RATE_LIMIT" : "Vivid Recall could not reach its AI models.");
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    if (version !== requestVersion) return;
    const reply = cleanText(payload?.reply, 700) ||
      "I’m following your clues. What is one more detail you remember?";
    history.push({ role: "assistant", content: reply });
    const verified = await verifyCandidates(payload?.candidates, version);
    if (version !== requestVersion) return;
    const extra = renderVerifiedCards(verified);
    addMessage("assistant", reply, extra);
    if (verified.length) setStatus("Checked " + verified.length + " title" + (verified.length === 1 ? "" : "s") + " against TMDB" + (payload?.model ? " · " + cleanText(payload.model, 80) : "") + ".");
    else if (Array.isArray(payload?.candidates) && payload.candidates.length) setStatus("I found possible titles, but none matched the TMDB catalogue closely enough yet.");
    else setStatus(payload?.model ? "Powered by " + cleanText(payload.model, 100) + " · Ask another question to narrow it down." : "Ask another question to narrow it down.");
  } catch (error) {
    if (version !== requestVersion) return;
    const rateLimited = error?.status === 429 || error?.message === "AIRFORCE_RATE_LIMIT";
    const fallback = rateLimited
      ? "I hit Airforce’s request limit for the moment. Some free-tier access is limited to about one request per minute, so let’s use Vivid’s local matcher for now. You can keep adding clues here and retry the AI later."
      : "I can keep helping with your memory, but the AI chat service is not connected right now. I’ll run Vivid’s local Recall search for your clue instead.";
    addMessage("assistant", fallback);
    setStatus(rateLimited ? "Airforce rate limit · switching to local Recall." : "AI chat unavailable · switching to local Recall.");
    const search = $("intent-query");
    const form = $("intent-form");
    if (search && form) {
      search.value = history.filter(item => item.role === "user").map(item => item.content).join(" ");
      window.__vividRecallLocalOnlyOnce = true;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  } finally {
    setBusy(false);
    if (input) input.focus({ preventScroll: true });
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
    $("recall-chat-messages").replaceChildren();
    addMessage("assistant", "Hey, I’m Vivid Recall. Tell me anything you remember — a scene, a character, a strange object, the ending, or just the feeling of the story. We’ll work it out together.");
    setStatus("");
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
