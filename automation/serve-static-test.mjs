import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/home.html";
  const target = path.resolve(root, "." + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(target).pipe(res);
  });
});
server.listen(port, "127.0.0.1", () => console.log("Browser smoke server listening on " + port));
