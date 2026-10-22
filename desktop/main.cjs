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

  // Start in immersive cinema mode; F11 or Escape returns to the normal desktop window.
  win.once("ready-to-show", () => {
    win.maximize();
    win.setFullScreen(true);
    win.show();
  });
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
    if (url !== localOrigin && !url.startsWith(localOrigin + "/")) {
      event.preventDefault();
      try {
        const target = new URL(url);
        if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(target.href);
      } catch { /* Ignore malformed or unsupported URLs. */ }
    }
  });
  void win.loadURL(localOrigin + "/home.html");
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
