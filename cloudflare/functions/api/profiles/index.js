const PROFILE_API = "https://vivid-cinema-api.vercel.app/api/profiles";

function errorResponse(code, message, status = 502) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0" }
  });
}

async function proxy(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+.+$/i.test(authorization)) {
    return errorResponse("unauthenticated", "Sign in with your Vivid account to manage profiles.", 401);
  }
  const url = new URL(request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = new Headers({ Authorization: authorization });
    const origin = request.headers.get("Origin");
    if (origin) headers.set("Origin", origin);
    if (request.method === "POST") headers.set("Content-Type", "application/json");
    const upstream = await fetch(PROFILE_API + url.search, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const timeoutError = error?.name === "AbortError";
    console.error("Vivid profile API upstream failed", { code: timeoutError ? "profile-api-timeout" : "profile-api-upstream-unavailable" });
    return errorResponse(
      timeoutError ? "profile-api-timeout" : "profile-api-upstream-unavailable",
      timeoutError ? "Vivid profile storage took too long to respond. Please retry." : "Vivid profile storage is temporarily unreachable. Please retry.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Allow": "GET, POST, OPTIONS",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet({ request }) {
  return proxy(request);
}

export async function onRequestPost({ request }) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 220000) return errorResponse("profile-payload-too-large", "The profile update is too large.", 413);
  return proxy(request);
}
