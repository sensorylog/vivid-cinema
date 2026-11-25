const ENDPOINT = "/api/african-stories/metrics";
const EVENTS = new Set(["atlas_view", "search_used", "region_filter", "country_open", "editorial_open", "title_open", "source_open", "player_unavailable", "submission_started", "submission_received"]);
function consentGranted() {
  return window.vividAnalyticsConsent === true || document.documentElement.dataset.analyticsConsent === "granted";
}
export function trackAfricanStories(event, dimensions = {}) {
  if (!consentGranted() || !EVENTS.has(event)) return false;
  const payload = { event };
  for (const key of ["countryCode", "region", "format", "accessState"]) {
    const value = dimensions[key];
    if (typeof value === "string" && value.length <= 40) payload[key] = value;
  }
  try {
    fetch(ENDPOINT, { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json", "X-Vivid-Analytics-Consent": "granted" },
      body: JSON.stringify(payload) }).catch(() => {});
    return true;
  } catch { return false; }
}