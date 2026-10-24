const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = app.getAppPath();
const windowsIcon = path.join(appRoot, "icons", "vivid-icon.ico");
const appIcon = fs.existsSync(windowsIcon)
  ? windowsIcon
  : path.join(appRoot, "icons", "vivid-icon-180.png");
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".mp4": "video/mp4"
};

if (process.platform === "win32") {
  app.setAppUserModelId("com.axisvision.vividcinema");
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
});

function createLocalServer(root) {
  const absoluteRoot = path.resolve(root);
  return http.createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method || "GET")) {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (pathname === "/") pathname = "/home.html";
    const target = path.resolve(absoluteRoot, "." + pathname);
    if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(target, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cache-Control": "no-store"
      });
      if (req.method === "HEAD") return res.end();
      const stream = fs.createReadStream(target);
      stream.on("error", () => { if (!res.headersSent) res.writeHead(500); res.end(); });
      stream.pipe(res);
    });
  });
}

let localServer;
let localOrigin;
const HOSTED_APP_URL = "https://vivid-cinema.pages.dev/home.html";
const HOSTED_APP_ORIGIN = new URL(HOSTED_APP_URL).origin;
const HOSTED_LOAD_TIMEOUT_MS = 12000;
// Keep the offline fallback on one origin so Firebase Auth and onboarding storage survive relaunches.
const LOCAL_SERVER_PORT = 43821;
const supportsOneClickUpdates = app.isPackaged && process.platform === "win32" &&
  !process.env.PORTABLE_EXECUTABLE_FILE && !process.env.PORTABLE_EXECUTABLE_DIR;
const LOADING_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vivid Cinema</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#050608;color:#f7f8fc;font-family:Segoe UI,system-ui,sans-serif}
body{min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 42%,#12172b 0%,#080a12 43%,#050608 78%)}
main{text-align:center;padding:28px}.brand{font-size:clamp(28px,4vw,42px);font-weight:750;letter-spacing:-1.6px}.brand span{font-weight:400;color:#a8b2c7}
p{margin:18px 0 22px;color:#9ca6bb;font-size:14px;letter-spacing:.02em}
.track{width:118px;height:3px;margin:auto;overflow:hidden;border-radius:8px;background:#ffffff20}.track span{display:block;width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#16c8ff,#6a5cff,#ff8a26);animation:move 1.25s ease-in-out infinite alternate}
@keyframes move{from{transform:translateX(-5%)}to{transform:translateX(145%)}}
@media(prefers-reduced-motion:reduce){.track span{animation:none}}
</style></head><body><main role="status" aria-live="polite"><div class="brand">Vivid<span>Cinema</span></div><p>Preparing your cinema experience…</p><div class="track" aria-hidden="true"><span></span></div></main></body></html>`;
const LOADING_URL = "data:text/html;charset=utf-8," + encodeURIComponent(LOADING_HTML);
const RECOVERY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconnect · Vivid Cinema</title>
<style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#050608;color:#f7f8fc;font-family:Segoe UI,system-ui,sans-serif}body{min-height:100vh;display:grid;place-items:center;text-align:center}main{max-width:520px;padding:32px}.brand{font-size:34px;font-weight:750;letter-spacing:-1px}.brand span{font-weight:400;color:#a8b2c7}p{color:#aab3c5;line-height:1.6}a{display:inline-block;margin-top:14px;padding:12px 20px;border-radius:12px;background:#7565ff;color:white;text-decoration:none;font-weight:650}</style></head>
<body><main role="status"><div class="brand">Vivid<span>Cinema</span></div><h1>Let's reconnect</h1><p>A page didn't load correctly. Your account data has not been cleared. Check your connection, then retry Vivid Cinema.</p><a href="https://vivid-cinema.pages.dev/home.html">Retry Vivid Cinema</a></main></body></html>`;
const RECOVERY_URL = "data:text/html;charset=utf-8," + encodeURIComponent(RECOVERY_HTML);

async function startLocalServer() {
  // Prefer the same origin every launch. Try a small stable range only if another
  // local process already owns the preferred port; never choose a random port.
  let lastError = null;
  for (let offset = 0; offset < 5; offset += 1) {
    const port = LOCAL_SERVER_PORT + offset;
    const candidate = createLocalServer(appRoot);
    try {
      await new Promise((resolve, reject) => {
        candidate.once("error", reject);
        candidate.listen(port, "localhost", resolve);
      });
      localServer = candidate;
      localOrigin = "http://localhost:" + port;
      return;
    } catch (error) {
      candidate.removeAllListeners();
      if (error?.code !== "EADDRINUSE") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to start local app server on a stable port");
}

function installApplicationMenu() { Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "Vivid Cinema", submenu: [{ label: "About Vivid Cinema", click: async () => dialog.showMessageBox({ title: "About Vivid Cinema", message: "Vivid Cinema", detail: "Version " + app.getVersion() + "\\nA cinematic discovery experience by Axis Vision.", buttons: ["OK"] }) }, { type: "separator" }, { role: "quit", label: "Exit Vivid Cinema" }] }, { label: "View", submenu: [{ role: "reload", label: "Reload", accelerator: "CmdOrCtrl+R" }, { role: "forceReload", label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R" }, { type: "separator" }, { label: "Toggle Full Screen", accelerator: "F11", click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.setFullScreen(!win.isFullScreen()); } }, { type: "separator" }, { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); } }, { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); } }, { label: "Reset Zoom", accelerator: "CmdOrCtrl+0", click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.setZoomLevel(0); } }] }, { label: "Help", submenu: [{ label: "Vivid Cinema Website", click: () => { void shell.openExternal(HOSTED_APP_URL); } }, { label: "Report an Issue", click: () => { void shell.openExternal("https://github.com/sensorylog/vivid-cinema/issues"); } }] }])); }


function isTrustedUpdateSender(event) {
  try {
    if (event.senderFrame !== event.sender.mainFrame) return false;
    const target = new URL(event.senderFrame.url);
    return target.origin === HOSTED_APP_ORIGIN ||
      Boolean(localOrigin && target.origin === new URL(localOrigin).origin);
  } catch { return false; }
}

function sendUpdateStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("vivid-update-status", status);
  }
}

function configureAutoUpdates() {
  if (!supportsOneClickUpdates) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("update-available", info => {
    sendUpdateStatus({ state: "available", version: info.version });
  });
  autoUpdater.on("download-progress", progress => {
    sendUpdateStatus({ state: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))) });
  });
  autoUpdater.on("update-downloaded", info => {
    sendUpdateStatus({ state: "downloaded", version: info.version });
  });
  autoUpdater.on("error", error => {
    console.warn("Vivid Cinema update check/install issue:", error?.message || error);
    sendUpdateStatus({ state: "error" });
  });
  ipcMain.handle("vivid-update-download", async event => {
    if (!isTrustedUpdateSender(event)) throw new Error("Untrusted update request");
    await autoUpdater.downloadUpdate();
    return true;
  });
  ipcMain.handle("vivid-update-install", event => {
    if (!isTrustedUpdateSender(event)) throw new Error("Untrusted update request");
    autoUpdater.quitAndInstall();
    return true;
  });
}

function scheduleUpdateChecks() {
  if (!supportsOneClickUpdates) return;
  const check = () => autoUpdater.checkForUpdates().catch(error => {
    console.warn("Vivid Cinema update check failed:", error?.message || error);
  });
  setTimeout(check, 15000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    show: false, fullscreen: true, backgroundColor: "#050608", autoHideMenuBar: true, title: "Vivid Cinema",
    icon: appIcon,
    webPreferences: { session: session.defaultSession, preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });

  // Show a tiny local splash immediately; the main app then loads on its trusted HTTPS origin.
  // F11 or Escape returns to the normal desktop window.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === "Escape" && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    } else if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      event.preventDefault();
    }
  });

  let localFallbackStarted = false;
  let hostedAppLoaded = false;
  let hostedLoadStarted = false;
  let hostedNavigationRecoveryInProgress = false;
  let hostedRecoveryPageShown = false;
  let hostedLoadTimeout;
  const clearHostedLoadTimeout = () => {
    if (hostedLoadTimeout) {
      clearTimeout(hostedLoadTimeout);
      hostedLoadTimeout = null;
    }
  };
  const fallbackToLocal = reason => {
    if (localFallbackStarted || hostedAppLoaded) return;
    localFallbackStarted = true;
    clearHostedLoadTimeout();
    console.warn("Vivid Cinema hosted origins unavailable; opening bundled offline fallback:", reason);
    if (localOrigin) void win.loadURL(localOrigin + "/home.html").catch(() => {});
  };
  win.webContents.on("did-finish-load", () => {
    let loadedOrigin;
    try { loadedOrigin = new URL(win.webContents.getURL()).origin; } catch { return; }
    if (loadedOrigin !== HOSTED_APP_ORIGIN) return;
    hostedAppLoaded = true;
    hostedNavigationRecoveryInProgress = false;
    hostedRecoveryPageShown = false;
    clearHostedLoadTimeout();
  });

  const showHostedRecoveryPage = reason => {
    if (hostedRecoveryPageShown || win.isDestroyed()) return;
    hostedRecoveryPageShown = true;
    hostedNavigationRecoveryInProgress = false;
    console.error("Vivid Cinema could not recover a hosted page navigation:", reason);
    void win.loadURL(RECOVERY_URL).catch(error => {
      console.error("Vivid Cinema recovery screen failed:", error?.message || error);
    });
  };
  const recoverHostedNavigation = reason => {
    if (hostedNavigationRecoveryInProgress) {
      showHostedRecoveryPage(reason);
      return;
    }
    hostedNavigationRecoveryInProgress = true;
    hostedRecoveryPageShown = false;
    console.warn("Vivid Cinema hosted page navigation failed; retrying the primary app origin:", reason);
    void win.loadURL(HOSTED_APP_URL).catch(error => {
      showHostedRecoveryPage(error?.message || reason);
    });
  };

  win.once("ready-to-show", () => {
    win.setFullScreen(true);
    win.show();
    if (hostedLoadStarted) return;
    hostedLoadStarted = true;
    hostedLoadTimeout = setTimeout(
      () => fallbackToLocal("Cloudflare Pages app load timed out after " + Math.round(HOSTED_LOAD_TIMEOUT_MS / 1000) + " seconds"),
      HOSTED_LOAD_TIMEOUT_MS
    );
    void win.loadURL(HOSTED_APP_URL).catch(error => fallbackToLocal(error?.message || "Cloudflare Pages navigation failed"));
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    let failedOrigin;
    try { failedOrigin = new URL(validatedURL).origin; } catch { return; }
    if (failedOrigin !== HOSTED_APP_ORIGIN) return;

    const reason = errorCode + " " + errorDescription;
    if (!hostedAppLoaded) {
      if (!localFallbackStarted) fallbackToLocal(reason);
      return;
    }

    // Unlike startup failures, later page failures must also recover. Previously
    // hostedAppLoaded caused every later failure to be ignored, leaving a black window.
    if (localFallbackStarted) return;
    recoverHostedNavigation(reason);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    const reason = "renderer process exited (" + (details?.reason || "unknown reason") + ")";
    if (!hostedAppLoaded) {
      if (!localFallbackStarted) fallbackToLocal(reason);
      return;
    }
    recoverHostedNavigation(reason);
  });

  win.on("closed", () => {
    if (hostedLoadTimeout) clearTimeout(hostedLoadTimeout);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const isFirebaseAuthPopup =
        target.protocol === "https:" &&
        (target.hostname === "accounts.google.com" ||
          target.hostname.endsWith(".firebaseapp.com"));
      if (isFirebaseAuthPopup) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true
            }
          }
        };
      }
      if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(target.href);
    } catch { /* Ignore malformed or unsupported URLs. */ }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    let target;
    try { target = new URL(url); } catch {
      event.preventDefault();
      return;
    }
    const isTrustedAppOrigin = target.origin === HOSTED_APP_ORIGIN ||
      Boolean(localOrigin && target.origin === new URL(localOrigin).origin);
    if (isTrustedAppOrigin) return;
    event.preventDefault();
    if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(target.href);
  });
  // The splash is self-contained, so it appears immediately without a network request.
  void win.loadURL(LOADING_URL).catch(error => {
    console.error("Vivid Cinema loading splash failed:", error);
    win.maximize();
    win.setFullScreen(true);
    win.show();
    fallbackToLocal(error?.message || "loading splash failed");
  });
}

if (hasSingleInstanceLock) {
app.whenReady().then(async () => {
  installApplicationMenu();
  configureAutoUpdates();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["fullscreen", "media", "notifications"].includes(permission));
  });
  try {
    await startLocalServer();
    createWindow();
    scheduleUpdateChecks();
  } catch (error) {
    console.error("Vivid Cinema desktop startup failed:", error);
    app.quit();
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (localServer) localServer.close(); });
}
