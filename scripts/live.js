const frame = document.getElementById("live-frame");
const refresh = document.getElementById("live-refresh");

refresh?.addEventListener("click", () => {
  if (!frame) return;
  const base = "https://www.2embed.online/iptv/";
  frame.src = base + "?v=" + Date.now();
});

frame?.addEventListener("load", () => {
  refresh?.removeAttribute("aria-busy");
  const label = refresh?.querySelector("span");
  if (label) label.textContent = "Refresh";
});

refresh?.addEventListener("click", () => {
  refresh.setAttribute("aria-busy", "true");
  const label = refresh.querySelector("span");
  if (label) label.textContent = "Loading…";
});
