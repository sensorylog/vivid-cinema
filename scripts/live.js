const frame = document.getElementById("live-frame");
const refresh = document.getElementById("live-refresh");

function setRefreshState(loading) {
  if (!refresh) return;
  refresh.setAttribute("aria-busy", String(loading));
  const label = refresh.querySelector("span");
  if (label) label.textContent = loading ? "Loading…" : "Refresh";
}

refresh?.addEventListener("click", () => {
  if (!frame) return;
  setRefreshState(true);
  frame.src = "https://www.2embed.online/iptv/?v=" + Date.now();
});

frame?.addEventListener("load", () => setRefreshState(false));
