const frame = document.getElementById("live-frame");
const player = document.getElementById("live-player");
const closePlayer = document.getElementById("live-close");
const playerTitle = document.getElementById("live-player-title");
const playerMeta = document.getElementById("live-player-meta");
const playerLoading = document.getElementById("live-player-loading");
const search = document.getElementById("live-search");
const grid = document.getElementById("live-channel-grid");
const guideStatus = document.getElementById("live-guide-status");
const filters = [...document.querySelectorAll("[data-live-filter]")];

const TWOEMBED_STREAM_BASE = "https://www.2embed.online/iptv/stream.php";

const CHANNELS = [
  {
    id: "atv-international",
    name: "&TV International",
    category: "international",
    country: "International",
    quality: "Auto,1080p,720p,480p,360p",
    streamUrl: "https://www.2embed.online/iptv/stream.php?url=N2lFS2R2cHpjbmFSSFRCNG5TOTI3MDFaS2xKWW1saFVwOUdVRDRqMEhlRXdMcmc4NHpLTERrWTZOY2NIdGdmblVXOWJKMFRYTmZzdE1HcWNoemdMZUk3NUZPUUdHMi92L1RUMkZYZ291NHlGZTRTOTJOUTVnZnA1Vm1QSzdvUGs4b0NtNS9qaTlJcVFMWERyZW92REF5QnFMM24yWkhnZEh2bHRyUTY3ZGg4PTo6DPl8NG74VB9DVg1WkNPVKg%3D%3D&title=%26TV+International&qualities=Auto,1080p,720p,480p,360p"
  }
];

let activeFilter = "all";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function buildChannelCard(channel) {
  return `
    <button class="vivid-live-channel" type="button" data-channel-id="${escapeHtml(channel.id)}">
      <span class="vivid-live-channel-art" aria-hidden="true"><i class="bi bi-broadcast"></i></span>
      <span class="vivid-live-channel-copy">
        <strong>${escapeHtml(channel.name)}</strong>
        <small>${escapeHtml(channel.country)} · Live</small>
      </span>
      <span class="vivid-live-channel-play" aria-hidden="true"><i class="bi bi-play-fill"></i></span>
    </button>
  `;
}

function visibleChannels() {
  const query = String(search?.value || "").trim().toLowerCase();
  return CHANNELS.filter(channel => {
    const categoryMatch = activeFilter === "all" || channel.category === activeFilter;
    const queryMatch = !query || [channel.name, channel.country, channel.category].join(" ").toLowerCase().includes(query);
    return categoryMatch && queryMatch;
  });
}

function renderChannels() {
  if (!grid) return;
  const channels = visibleChannels();
  grid.innerHTML = channels.length
    ? channels.map(buildChannelCard).join("")
    : `<div class="vivid-live-empty"><i class="bi bi-tv"></i><strong>No channels found</strong><span>Try another search or category.</span></div>`;

  if (guideStatus) {
    guideStatus.textContent = channels.length
      ? `${channels.length} channel${channels.length === 1 ? "" : "s"} available in this guide.`
      : "No matching channels.";
  }
}

function showPlayer(channel) {
  if (!frame || !player || !channel) return;
  if (playerTitle) playerTitle.textContent = channel.name;
  if (playerMeta) playerMeta.textContent = `${channel.country} · 2Embed live stream`;
  if (playerLoading) playerLoading.hidden = false;
  player.hidden = false;
  frame.src = channel.streamUrl;
  player.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hidePlayer() {
  if (!player || !frame) return;
  frame.src = "about:blank";
  player.hidden = true;
  if (playerLoading) playerLoading.hidden = true;
}

grid?.addEventListener("click", event => {
  const button = event.target.closest("[data-channel-id]");
  if (!button) return;
  const channel = CHANNELS.find(item => item.id === button.dataset.channelId);
  showPlayer(channel);
});

closePlayer?.addEventListener("click", hidePlayer);

frame?.addEventListener("load", () => {
  if (playerLoading) playerLoading.hidden = true;
});

search?.addEventListener("input", renderChannels);

filters.forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.liveFilter || "all";
    filters.forEach(item => item.classList.toggle("is-active", item === button));
    renderChannels();
  });
});

renderChannels();
