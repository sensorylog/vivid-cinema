const { app, BrowserWindow, shell, session } = require("electron");
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
const HOSTED_APP_URL = "https://vivid-cinema.web.app/home.html";
const HOSTED_APP_ORIGIN = new URL(HOSTED_APP_URL).origin;
const HOSTED_LOAD_TIMEOUT_MS = 12000;
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

async function startLocalServer() {
  localServer = createLocalServer(appRoot);
  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "localhost", resolve);
  });
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to start local app server");
  localOrigin = "http://localhost:" + address.port;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    show: false, backgroundColor: "#050608", autoHideMenuBar: true, title: "Vivid Cinema",
    icon: appIcon,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
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
    }
  });

  let localFallbackStarted = false;
  let hostedAppLoaded = false;
  let hostedLoadStarted = false;
  let hostedLoadTimeout;
  const fallbackToLocal = reason => {
    if (localFallbackStarted || hostedAppLoaded) return;
    localFallbackStarted = true;
    if (hostedLoadTimeout) clearTimeout(hostedLoadTimeout);
    console.warn("Vivid Cinema hosted app unavailable; opening bundled offline fallback:", reason);
    if (localOrigin) void win.loadURL(localOrigin + "/home.html").catch(() => {});
  };
  win.webContents.on("did-finish-load", () => {
    let loadedOrigin;
    try { loadedOrigin = new URL(win.webContents.getURL()).origin; } catch { return; }
    if (loadedOrigin !== HOSTED_APP_ORIGIN) return;
    hostedAppLoaded = true;
    if (hostedLoadTimeout) clearTimeout(hostedLoadTimeout);
  });
  win.once("ready-to-show", () => {
    win.maximize();
    win.setFullScreen(true);
    win.show();
    if (hostedLoadStarted) return;
    hostedLoadStarted = true;
    hostedLoadTimeout = setTimeout(
      () => fallbackToLocal("hosted app load timed out after " + Math.round(HOSTED_LOAD_TIMEOUT_MS / 1000) + " seconds"),
      HOSTED_LOAD_TIMEOUT_MS
    );
    void win.loadURL(HOSTED_APP_URL).catch(error => fallbackToLocal(error?.message || "hosted navigation failed"));
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || localFallbackStarted || hostedAppLoaded || errorCode === -3) return;
    let failedOrigin;
    try { failedOrigin = new URL(validatedURL).origin; } catch { return; }
    if (failedOrigin !== HOSTED_APP_ORIGIN) return;
    fallbackToLocal(errorCode + " " + errorDescription);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const isFirebaseAuthPopup =
        target.protocol === "https:" &&
        (target.hostname === "accounts.google.com" ||
          target.hostname.endsWith(".firebaseapp.com") ||
          target.hostname.endsWith(".web.app"));
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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["fullscreen", "media", "notifications"].includes(permission));
  });
  try {
    await startLocalServer();
    createWindow();
  } catch (error) {
    console.error("Vivid Cinema desktop startup failed:", error);
    app.quit();
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (localServer) localServer.close(); });
