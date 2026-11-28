const PROFILE_PIN_SERVICE = "https://vivid-cinema-api.vercel.app/api/profile-pin";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Allow": "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request }) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+.+$/i.test(authorization)) {
    return json({ ok: false, code: "unauthenticated", message: "Sign in to manage profile security." }, 401);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, code: "request-too-large", message: "The profile security request is too large." }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  } catch {
    return json({ ok: false, code: "invalid-request", message: "The profile security request could not be read." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(PROFILE_PIN_SERVICE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
        ...(request.headers.get("Origin") ? { Origin: request.headers.get("Origin") } : {})
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await upstream.text();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json({
      ok: false,
      code: timedOut ? "profile-security-timeout" : "profile-security-upstream-unavailable",
      message: timedOut
        ? "Vivid profile security took too long to respond. Please retry."
        : "Vivid profile security is temporarily unreachable. Please retry in a moment."
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
