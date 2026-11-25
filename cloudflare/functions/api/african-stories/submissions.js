const MAX_BODY_BYTES = 8192;
const FORMATS = new Set(["feature", "documentary", "short", "series", "animation", "archive", "other"]);
const ROLES = new Set(["director", "producer", "rights_holder", "sales_agent", "archive", "representative", "other"]);
function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
  }});
}
function validPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasText = (key, max) => typeof value[key] === "string" && value[key].trim().length > 0 && value[key].length <= max;
  if (!hasText("title", 160) || !/^[A-Z]{2}$/.test(value.countryCode || "") ||
      !FORMATS.has(value.format) || !hasText("submitterName", 120) || !ROLES.has(value.role) ||
      !hasText("email", 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
      value.rightsDeclaration !== true || value.privacyConsent !== true) return false;
  if (value.year !== null && value.year !== undefined && (!Number.isInteger(value.year) || value.year < 1895 || value.year > new Date().getUTCFullYear() + 1)) return false;
  if (!Array.isArray(value.languages) || value.languages.length > 12 || !value.languages.every(item => typeof item === "string" && item.trim() && item.length <= 60)) return false;
  if (typeof value.note !== "string" || value.note.length > 1200 || typeof value.projectUrl !== "string" || value.projectUrl.length > 500) return false;
  if (value.projectUrl) { try { if (new URL(value.projectUrl).protocol !== "https:") return false; } catch { return false; } }
  return true;
}
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { ok: false, code: "method-not-allowed", message: "Use POST to submit a title." });
  const origin = request.headers.get("Origin");
  if (origin) { try { if (origin !== new URL(request.url).origin) return json(403, { ok: false, code: "cross-origin", message: "Cross-origin submissions are not allowed." }); } catch { return json(400, { ok: false, code: "invalid-origin", message: "The request origin is invalid." }); } }
  if (!env.AFRICAN_STORIES_INTAKE || typeof env.AFRICAN_STORIES_INTAKE.fetch !== "function") return json(503, { ok: false, code: "intake-not-configured", message: "Secure submissions are not enabled yet. No submission has been stored. Please try again later." });
  const raw = await request.text().catch(() => "");
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { ok: false, code: "invalid-body-size", message: "The submission is empty or too large." });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, code: "invalid-json", message: "A valid submission is required." }); }
  if (!validPayload(body)) return json(400, { ok: false, code: "invalid-submission", message: "Please provide valid title, contact and rights-holder details." });
  try {
    const upstream = await env.AFRICAN_STORIES_INTAKE.fetch("https://african-stories-intake.internal/submissions", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, submittedAt: new Date().toISOString(), source: "vivid-african-stories", rightsGranted: false, status: "received_for_review" })
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.ok !== true || typeof result.reference !== "string" || !/^[A-Za-z0-9_-]{4,80}$/.test(result.reference)) return json(502, { ok: false, code: "intake-upstream-failed", message: "The secure intake service could not confirm receipt. Please retry later." });
    return json(202, { ok: true, reference: result.reference, message: "Received for review; no distribution rights are granted." });
  } catch { return json(502, { ok: false, code: "intake-unavailable", message: "The secure intake service is temporarily unavailable." }); }
}