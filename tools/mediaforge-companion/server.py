#!/usr/bin/env python3
"""Loopback-only, read-only adapter for MediaForge documented v1 endpoints."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import json, os
HOST = "127.0.0.1"
PORT = int(os.environ.get("VIVID_MEDIAFORGE_COMPANION_PORT", "8765"))
BASE_URL = os.environ.get("MEDIAFORGE_URL", "http://127.0.0.1:8080").rstrip("/")
API_KEY = os.environ.get("MEDIAFORGE_API_KEY", "").strip()
ALLOWED_ORIGINS = {v.strip().rstrip("/") for v in os.environ.get("VIVID_ALLOWED_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(",") if v.strip()}
ROUTES = {"/api/status": "/api/v1/status", "/api/queue": "/api/v1/queue", "/api/library": "/api/v1/library"}
MAX_RESPONSE_BYTES = 2 * 1024 * 1024

def validate_config():
    parsed = urlsplit(BASE_URL)
    if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("MEDIAFORGE_URL must be a local HTTP address.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("MEDIAFORGE_URL must be a base URL without credentials, query, or fragment.")
    if not API_KEY:
        raise RuntimeError("Set MEDIAFORGE_API_KEY to a scoped MediaForge API key.")
    if not 1 <= PORT <= 65535:
        raise RuntimeError("VIVID_MEDIAFORGE_COMPANION_PORT must be a valid TCP port.")

class Handler(BaseHTTPRequestHandler):
    server_version = "VividMediaForgeCompanion/0.1"
    def _json(self, status, payload, origin=None):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "300")
        self.send_header("Vary", "Origin")
        self.end_headers()
    def do_GET(self):
        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "origin_not_allowed"})
            return
        host = self.headers.get("Host", "").split(":")[0].strip("[]").lower()
        if host not in {"localhost", "127.0.0.1"}:
            self._json(403, {"error": "host_not_allowed"})
            return
        if self.path == "/health":
            self._json(200, {"ok": True, "mode": "read-only"}, origin)
            return
        upstream_path = ROUTES.get(self.path)
        if not upstream_path:
            self._json(404, {"error": "route_not_found"}, origin)
            return
        request = Request(BASE_URL + upstream_path, headers={"X-Api-Key": API_KEY, "Accept": "application/json"}, method="GET")
        try:
            with urlopen(request, timeout=5) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    self._json(502, {"error": "upstream_response_too_large"}, origin)
                    return
                try:
                    payload = json.loads(data.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._json(502, {"error": "invalid_upstream_json"}, origin)
                    return
                self._json(response.status, payload, origin)
        except HTTPError as error:
            self._json(502, {"error": "mediaforge_http_error", "upstream_status": error.code}, origin)
        except (URLError, TimeoutError, OSError):
            self._json(502, {"error": "mediaforge_unavailable"}, origin)
    def log_message(self, fmt, *args):
        print("MediaForge companion request:", args[0] if args else "request")

def main():
    validate_config()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Vivid MediaForge read-only companion listening on http://127.0.0.1:" + str(PORT))
    print("Routes: /health, /api/status, /api/queue, /api/library")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
if __name__ == "__main__":
    main()
