// Keep the household screen recoverable if a module/CDN import or Firebase
// auth restoration never settles. The main selector removes its loading node
// as soon as it renders profiles or an actionable error.
(() => {
  window.setTimeout(() => {
    const grid = document.getElementById("profile-grid");
    if (!grid?.querySelector(".profile-loading")) return;

    grid.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "profile-load-error";
    panel.setAttribute("role", "alert");

    const message = document.createElement("p");
    message.textContent = "Vivid is taking longer than expected to restore your sign-in and load your household. Your account is safe. Please retry.";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "profile-load-retry";
    retry.textContent = "Retry profile loading";
    retry.addEventListener("click", () => window.location.reload());

    panel.append(message, retry);
    grid.append(panel);

    const status = document.getElementById("profile-status");
    if (status) {
      status.textContent = "Profile loading timed out. Retry when your connection is ready.";
      status.dataset.state = "error";
    }
  }, 20_000);
})();
