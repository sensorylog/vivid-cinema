const { ipcRenderer } = require("electron");

const trustedHosts = new Set(["vivid-cinema.pages.dev", "localhost"]);
if (trustedHosts.has(location.hostname)) {
  let latestStatus = null;
  let banner = null;
  let message = null;
  let action = null;
  let dismissedVersion = null;

  const createBanner = () => {
    if (banner || !document.body) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("/styles/vivid-desktop-update.css", location.origin).href;
    stylesheet.dataset.vividDesktopUpdateStyles = "true";
    document.head.appendChild(stylesheet);

    banner = document.createElement("aside");
    banner.className = "vivid-desktop-update";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const brand = document.createElement("span");
    brand.className = "vivid-desktop-update__brand";
    brand.textContent = "✦";
    const copy = document.createElement("div");
    copy.className = "vivid-desktop-update__copy";
    const title = document.createElement("strong");
    title.className = "vivid-desktop-update__title";
    title.textContent = "Vivid Cinema update";
    message = document.createElement("span");
    message.className = "vivid-desktop-update__message";
    copy.append(title, message);
    action = document.createElement("button");
    action.type = "button";
    action.className = "vivid-desktop-update__action";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vivid-desktop-update__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss update notification");
    close.addEventListener("click", () => {
      if (latestStatus?.version) dismissedVersion = latestStatus.version;
      banner.hidden = true;
    });
    banner.append(brand, copy, action, close);
    document.body.appendChild(banner);
  };

  const render = status => {
    latestStatus = status;
    if (!document.body || !status) return;
    if (status.state === "available" && status.version === dismissedVersion) return;
    if (status.state === "error" && !banner) return;
    createBanner();
    if (!banner) return;
    banner.hidden = false;
    action.disabled = false;
    if (status.state === "available") {
      message.textContent = "Version " + status.version + " is ready. Download it when you're ready.";
      action.textContent = "Update";
      action.onclick = async () => {
        action.disabled = true;
        action.textContent = "Starting…";
        try { await ipcRenderer.invoke("vivid-update-download"); }
        catch { render({ state: "error" }); }
      };
    } else if (status.state === "downloading") {
      message.textContent = "Downloading your update… " + status.percent + "%";
      action.textContent = status.percent + "%";
      action.disabled = true;
      action.onclick = null;
    } else if (status.state === "downloaded") {
      message.textContent = "Version " + status.version + " is downloaded and ready to install.";
      action.textContent = "Restart & install";
      action.onclick = async () => {
        action.disabled = true;
        action.textContent = "Restarting…";
        try { await ipcRenderer.invoke("vivid-update-install"); }
        catch { render({ state: "error" }); }
      };
    } else if (status.state === "error") {
      message.textContent = "The update couldn't be completed. You can keep watching and try again later.";
      action.textContent = "Dismiss";
      action.onclick = () => { banner.hidden = true; };
    }
  };

  ipcRenderer.on("vivid-update-status", (_event, status) => render(status));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render(latestStatus), { once: true });
  } else {
    render(latestStatus);
  }
}
