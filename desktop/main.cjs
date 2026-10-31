const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, net, protocol } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
protocol.registerSchemesAsPrivileged([{ scheme: "vivid-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const { DesktopDownloadEngine } = require("./download-engine.cjs");

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
    let parsedUrl;
    let pathname;
    try {
      parsedUrl = new URL(req.url || "/", "http://localhost");
      pathname = decodeURIComponent(parsedUrl.pathname);
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
let downloadEngine;
const mediaToken = crypto.randomBytes(32).toString("hex");
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
<style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#050608;color:#f7f8fc;font-family:Segoe UI,system-ui,sans-serif}body{min-height:100vh;display:grid;place-items:center;text-align:center}main{max-width:520px;padding:32px}.brand{font-size:34px;font-weight:750;letter-spacing:-1px}.brand span{font-weight:400;color:#a8b2c7}p{color:#aab3c5;line-height:1.6}a{display:inline-block;margin:14px 6px 0;padding:12px 20px;border-radius:12px;background:#7565ff;color:white;text-decoration:none;font-weight:650}a.secondary{background:#252a3b}</style></head>
<body><main role="status"><div class="brand">Vivid<span>Cinema</span></div><h1>Let's reconnect</h1><p>A page didn't load correctly. Your account data has not been cleared. Check your connection, then retry Vivid Cinema.</p><a href="https://vivid-cinema.pages.dev/home.html">Retry Vivid Cinema</a><!--LOCAL_RETRY_LINK--></main></body></html>`;
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


function isTrustedDownloadSender(event) {
  try {
    if (event.senderFrame !== event.sender.mainFrame) return false;
    const origin = new URL(event.senderFrame.url).origin;
    return origin === HOSTED_APP_ORIGIN || Boolean(localOrigin && origin === new URL(localOrigin).origin);
  } catch { return false; }
}

function configureOfflineMediaProtocol() {
  protocol.handle("vivid-media", async request => {
    const url = new URL(request.url);
    if (url.hostname !== "download" || url.searchParams.get("token") !== mediaToken) return new Response("Forbidden", { status: 403 });
    const id = decodeURIComponent(url.pathname.slice(1));
    const fileIndex = Number(url.searchParams.get("file") || 0);
    const filePath = downloadEngine && downloadEngine.mediaFile(id, fileIndex);
    if (!filePath) return new Response("Media not found", { status: 404 });
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch { return new Response("Media not found", { status: 404 }); }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".mp4":"video/mp4", ".m4v":"video/mp4", ".mkv":"video/x-matroska", ".webm":"video/webm", ".mov":"video/quicktime", ".avi":"video/x-msvideo", ".ogv":"video/ogg", ".mpg":"video/mpeg", ".mpeg":"video/mpeg", ".wmv":"video/x-ms-wmv", ".flv":"video/x-flv", ".ts":"video/mp2t", ".m2ts":"video/mp2t", ".3gp":"video/3gpp" };
    const headers = new Headers({ "Content-Type":types[ext] || "application/octet-stream", "Accept-Ranges":"bytes", "Content-Length":String(stat.size), "Access-Control-Allow-Origin":"*", "Cache-Control":"no-store" });
    const range = request.headers.get("range");
    if (range) {
      const raw = String(range).replace("bytes=", "").split("-");
      const start = raw[0] ? Number(raw[0]) : Math.max(0, stat.size - Number(raw[1] || 0));
      const end = raw[0] && raw[1] ? Math.min(Number(raw[1]), stat.size - 1) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return new Response(null, { status:416, headers:{ "Content-Range":"bytes */" + stat.size } });
      headers.set("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
      headers.set("Content-Length", String(end - start + 1));
      if (request.method === "HEAD") return new Response(null, { status:206, headers });
      return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status:206, headers });
    }
    if (request.method === "HEAD") return new Response(null, { status:200, headers });
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status:200, headers });
  });
}
function configureDownloadEngine() {
  downloadEngine = new DesktopDownloadEngine({ app, BrowserWindow, dialog, shell });
  ipcMain.handle("vivid-download-search", (event, query) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    return downloadEngine.search(query);
  });
  ipcMain.handle("vivid-download-start", (event, result, media) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    return downloadEngine.start(result, media);
  });
  ipcMain.handle("vivid-download-list", event => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    return downloadEngine.list();
  });
  ipcMain.handle("vivid-playback-position-get", (event, id, fileIndex = 0) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted playback request");
    return downloadEngine.getPlaybackPosition(id, fileIndex);
  });
  ipcMain.handle("vivid-playback-position-set", async (event, id, fileIndex = 0, seconds = 0) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted playback request");
    return downloadEngine.setPlaybackPosition(id, fileIndex, seconds);
  });
  ipcMain.handle("vivid-playback-position-clear", async (event, id, fileIndex = 0) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted playback request");
    return downloadEngine.clearPlaybackPosition(id, fileIndex);
  });
  ipcMain.handle("vivid-download-media-url", (event, id, fileIndex = 0) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    if (!downloadEngine.mediaFile(id, fileIndex)) throw new Error("This download is not ready to play.");
    return "vivid-media://download/" + encodeURIComponent(String(id)) + "?file=" + encodeURIComponent(String(fileIndex)) + "&token=" + mediaToken;
  });
  ipcMain.handle("vivid-offline-url", event => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted offline navigation request");
    return localOrigin + "/my-downloads.html";
  });
  ipcMain.handle("vivid-download-folder", async event => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    return downloadEngine.chooseFolder();
  });
  ipcMain.handle("vivid-download-control", (event, id, action) => {
    if (!isTrustedDownloadSender(event)) throw new Error("Untrusted download request");
    return downloadEngine.control(id, action);
  });
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
  let navigationRecoveryInProgress = false;
  let recoveryPageShown = false;
  let localAppLoaded = false;
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
    const isHostedApp = loadedOrigin === HOSTED_APP_ORIGIN;
    const isLocalApp = Boolean(localOrigin && loadedOrigin === new URL(localOrigin).origin);
    if (!isHostedApp && !isLocalApp) return;
    if (isHostedApp) hostedAppLoaded = true;
    if (isLocalApp) localAppLoaded = true;
    navigationRecoveryInProgress = false;
    recoveryPageShown = false;
    clearHostedLoadTimeout();
  });

  const showAppRecoveryPage = reason => {
    if (recoveryPageShown || win.isDestroyed()) return;
    recoveryPageShown = true;
    navigationRecoveryInProgress = false;
    console.error("Vivid Cinema could not recover an app page navigation:", reason);
    const localRetryLink = localOrigin
      ? '<a class="secondary" href="' + localOrigin + '/home.html">Try offline copy</a>'
      : "";
    const recoveryHtml = RECOVERY_HTML.replace("<!--LOCAL_RETRY_LINK-->", localRetryLink);
    const recoveryUrl = localRetryLink
      ? "data:text/html;charset=utf-8," + encodeURIComponent(recoveryHtml)
      : RECOVERY_URL;
    void win.loadURL(recoveryUrl).catch(error => {
      console.error("Vivid Cinema recovery screen failed:", error?.message || error);
    });
  };
  const recoverAppNavigation = (retryUrl, reason) => {
    if (navigationRecoveryInProgress) {
      showAppRecoveryPage(reason);
      return;
    }
    navigationRecoveryInProgress = true;
    recoveryPageShown = false;
    console.warn("Vivid Cinema app page navigation failed; retrying its existing origin:", reason);
    void win.loadURL(retryUrl).catch(error => {
      showAppRecoveryPage(error?.message || reason);
    });
  };

  win.once("ready-to-show", () => {
    win.setFullScreen(true);
    win.show();
    if (hostedLoadStarted) return;
    hostedLoadStarted = true;
    if (!net.isOnline()) {
      void win.loadURL(localOrigin + "/my-downloads.html").catch(error => console.warn("Vivid offline library could not be opened:", error?.message || error));
      return;
    }
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
    const isHostedApp = failedOrigin === HOSTED_APP_ORIGIN;
    const isLocalApp = Boolean(localOrigin && failedOrigin === new URL(localOrigin).origin);
    if (!isHostedApp && !isLocalApp) return;

    const reason = errorCode + " " + errorDescription;
    if (isHostedApp && !hostedAppLoaded) {
      if (!localFallbackStarted) fallbackToLocal(reason);
      return;
    }

    // Recover failures after startup on either trusted app origin. The old
    // handler ignored all post-startup failures, leaving a black window.
    const retryUrl = isHostedApp ? HOSTED_APP_URL : localOrigin + "/home.html";
    recoverAppNavigation(retryUrl, reason);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    const reason = "renderer process exited (" + (details?.reason || "unknown reason") + ")";
    if (hostedAppLoaded) {
      recoverAppNavigation(HOSTED_APP_URL, reason);
      return;
    }
    if (localOrigin && (localAppLoaded || localFallbackStarted)) {
      recoverAppNavigation(localOrigin + "/home.html", reason);
      return;
    }
    if (!localFallbackStarted) fallbackToLocal(reason);
    else showAppRecoveryPage(reason);
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
    configureDownloadEngine();
    configureOfflineMediaProtocol();
    createWindow();
    scheduleUpdateChecks();
  } catch (error) {
    console.error("Vivid Cinema desktop startup failed:", error);
    app.quit();
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
let shutdownStarted = false;
app.on("before-quit", event => {
  if (downloadEngine && !shutdownStarted) {
    event.preventDefault(); shutdownStarted = true;
    void downloadEngine.shutdown().finally(() => { if (localServer) localServer.close(); app.quit(); });
    return;
  }
  if (localServer) localServer.close();
});
}
