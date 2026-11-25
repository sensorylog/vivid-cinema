const EVENTS = new Set(["atlas_view", "search_used", "region_filter", "country_open", "editorial_open", "title_open", "source_open", "player_unavailable", "submission_started", "submission_received"]);
const CODES = {
  countryCode: /^[A-Z]{2}$/, region: /^(north|west|central|east|southern)$/,
  format: /^(feature|documentary|oral_history|newsreel|archive_footage|historical_drama|short|series|animation|archive|other)$/,
  accessState: /^(stream_on_vivid|watch_officially|discover_archive_record|access_pending)$/
};
function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"
  }});
}
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { ok: false, code: "method-not-allowed" });
  const origin = request.headers.get("Origin");
  if (origin) { try { if (origin !== new URL(request.url).origin) return json(403, { ok: false, code: "cross-origin" }); } catch { return json(400, { ok: false, code: "invalid-origin" }); } }
  if (request.headers.get("X-Vivid-Analytics-Consent") !== "granted") return json(403, { ok: false, code: "consent-required" });
  if (!env.AFRICAN_STORIES_ANALYTICS || typeof env.AFRICAN_STORIES_ANALYTICS.writeDataPoint !== "function") return json(503, { ok: false, code: "analytics-not-configured" });
  const raw = await request.text().catch(() => "");
  if (!raw || new TextEncoder().encode(raw).byteLength > 1024) return json(413, { ok: false, code: "invalid-body-size" });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, code: "invalid-json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !EVENTS.has(body.event)) return json(400, { ok: false, code: "invalid-event" });
  const dimensions = {};
  for (const [key, pattern] of Object.entries(CODES)) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || !pattern.test(body[key])) return json(400, { ok: false, code: "invalid-dimension" });
    dimensions[key] = body[key];
  }
  const allowed = new Set(["event", ...Object.keys(CODES)]);
  if (Object.keys(body).some(key => !allowed.has(key))) return json(400, { ok: false, code: "unknown-field" });
  try {
    await env.AFRICAN_STORIES_ANALYTICS.writeDataPoint({
      blobs: [body.event, dimensions.countryCode || "", dimensions.region || "", dimensions.format || "", dimensions.accessState || ""],
      doubles: [1], indexes: ["african-stories"]
    });
    return json(202, { ok: true });
  } catch { return json(502, { ok: false, code: "analytics-write-failed" }); }
}