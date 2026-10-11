import {
  listCustomPlaybackServers,
  removeCustomPlaybackServer,
  saveCustomPlaybackServer
} from "./playback-servers.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export function mountPlaybackServerSettings(panel, onChange = () => {}) {
  if (!panel) return;
  panel.querySelector("#vivid-custom-server-tools")?.remove();

  const root = document.createElement("section");
  root.id = "vivid-custom-server-tools";
  root.className = "vivid-custom-server-tools";
  root.innerHTML = `
    <div class="vivid-custom-server-list" id="vivid-custom-server-list" aria-label="Your custom servers"></div>
    <details class="vivid-custom-server-settings">
      <summary><i class="bi bi-sliders" aria-hidden="true"></i> Manage your servers</summary>
      <p class="vivid-custom-server-help">Add an HTTPS embed server you own or are authorized to use. These settings stay on this device.</p>
      <form id="vivid-custom-server-form" novalidate>
        <label for="vivid-server-name">Server name</label>
        <input id="vivid-server-name" name="name" maxlength="48" autocomplete="off" required placeholder="My streaming server">
        <label for="vivid-server-url">HTTPS base URL</label>
        <input id="vivid-server-url" name="url" type="url" inputmode="url" autocomplete="url" required placeholder="https://video.example.com">
        <label for="vivid-server-movie-pattern">Movie URL pattern</label>
        <input id="vivid-server-movie-pattern" name="movieUrlPattern" autocomplete="off" required value="{url}/movie/{tmdbId}?autoplay=true">
        <label for="vivid-server-tv-pattern">TV episode URL pattern</label>
        <input id="vivid-server-tv-pattern" name="tvUrlPattern" autocomplete="off" required value="{url}/tv/{tmdbId}/{season}/{episode}?autoplay=true">
        <p class="vivid-custom-server-help">Supported placeholders: {url}, {type}, {tmdbId}, {imdbId}, {slug}, {season}, {episode}. Both patterns must resolve to the same HTTPS origin as the base URL.</p>
        <button type="submit" class="vivid-custom-server-save"><i class="bi bi-plus-lg" aria-hidden="true"></i> Add server</button>
        <p id="vivid-custom-server-status" class="vivid-custom-server-status" role="status" aria-live="polite"></p>
      </form>
      <p class="vivid-custom-server-license-note">Vivid only opens the configured embed page. It does not scrape protected players, bypass DRM, or verify a provider’s content rights.</p>
    </details>`;

  const sourceList = root.querySelector("#vivid-custom-server-list");
  const form = root.querySelector("#vivid-custom-server-form");
  const status = root.querySelector("#vivid-custom-server-status");

  const render = () => {
    const servers = listCustomPlaybackServers();
    sourceList.innerHTML = servers.length
      ? '<div class="vivid-custom-server-heading">Your servers</div>' + servers.map(server => `
        <div class="vivid-custom-server-row">
          <button type="button" class="vivid-player-source vivid-custom-source" data-player-source="${escapeHtml("custom:" + server.id)}" aria-pressed="false">
            <span class="vivid-server-dot" aria-hidden="true"></span>
            <span class="vivid-custom-server-copy"><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(new URL(server.url).host)} · custom embed</small></span>
            <span class="vivid-server-state" data-server-state="${escapeHtml("custom:" + server.id)}">Ready to try</span>
          </button>
          <button type="button" class="vivid-custom-server-remove" data-remove-custom-server="${escapeHtml(server.id)}" aria-label="Remove ${escapeHtml(server.name)}"><i class="bi bi-trash3" aria-hidden="true"></i></button>
        </div>`).join("")
      : '<p class="vivid-custom-server-empty">No custom servers yet. Add one below.</p>';
    onChange();
  };

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      saveCustomPlaybackServer({
        name: data.get("name"),
        url: data.get("url"),
        movieUrlPattern: data.get("movieUrlPattern"),
        tvUrlPattern: data.get("tvUrlPattern")
      });
      form.reset();
      form.querySelector('[name="movieUrlPattern"]').value = "{url}/movie/{tmdbId}?autoplay=true";
      form.querySelector('[name="tvUrlPattern"]').value = "{url}/tv/{tmdbId}/{season}/{episode}?autoplay=true";
      status.textContent = "Server saved. Select it above to try playback.";
      status.classList.remove("is-warning");
      render();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not save this server.";
      status.classList.add("is-warning");
    }
  });

  root.addEventListener("click", event => {
    const removeButton = event.target.closest("[data-remove-custom-server]");
    if (!removeButton) return;
    const id = removeButton.getAttribute("data-remove-custom-server");
    if (!removeCustomPlaybackServer(id)) {
      status.textContent = "Could not remove this server from browser storage.";
      status.classList.add("is-warning");
      return;
    }
    if (removeButton.closest(".vivid-custom-server-row")?.querySelector("[aria-pressed='true']")) {
      // The source switcher will reset to its normal default on the next play.
    }
    status.textContent = "Server removed.";
    status.classList.remove("is-warning");
    render();
  });

  panel.appendChild(root);
  render();
}
