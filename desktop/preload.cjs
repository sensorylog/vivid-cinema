const { ipcRenderer } = require("electron");

const trustedHosts = new Set(["vivid-cinema.netlify.app", "vivid-cinema.web.app", "localhost"]);
if (trustedHosts.has(location.hostname)) {
  let latestStatus = null;
  let banner = null;
  let message = null;
  let action = null;
  let close = null;
  let dismissedVersion = null;

  const createBanner = () => {
    if (banner || !document.body) return;
    banner = document.createElement("aside");
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.style.cssText = "position:fixed;z-index:2147483000;top:16px;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 28px));box-sizing:border-box;display:flex;align-items:center;gap:14px;padding:15px 16px;border:1px solid rgba(125,145,190,.35);border-radius:16px;background:#101421;color:#f6f8ff;box-shadow:0 18px 60px rgba(0,0,0,.48);font:500 14px/1.4 Segoe UI,system-ui,sans-serif";
    const brand = document.createElement("span");
    brand.textContent = "✦";
    brand.style.cssText = "font-size:23px;color:#9bb7ff;flex:0 0 auto";
    const copy = document.createElement("div");
    copy.style.cssText = "flex:1;min-width:0";
    const title = document.createElement("strong");
    title.textContent = "Vivid Cinema update";
    title.style.cssText = "display:block;font-size:14px;margin-bottom:3px";
    message = document.createElement("span");
    message.style.cssText = "display:block;color:#c3cadd;font-size:12px";
    copy.append(title, message);
    action = document.createElement("button");
    action.type = "button";
    action.style.cssText = "flex:0 0 auto;border:0;border-radius:10px;padding:10px 13px;background:#e9edff;color:#151a2a;font:700 12px Segoe UI,system-ui,sans-serif;cursor:pointer";
    close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss update notification");
    close.style.cssText = "flex:0 0 auto;border:0;background:transparent;color:#c3cadd;font-size:22px;cursor:pointer;padding:0 2px";
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
    action.style.opacity = "1";
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
      action.style.opacity = ".75";
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
