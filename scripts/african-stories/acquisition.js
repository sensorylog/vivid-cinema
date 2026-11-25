const form = document.getElementById("african-submission-form");
const status = document.getElementById("african-submission-status");
const country = document.getElementById("submission-country");
const FORMATS = new Set(["feature", "documentary", "short", "series", "animation", "archive", "other"]);
const ROLES = new Set(["director", "producer", "rights_holder", "sales_agent", "archive", "representative", "other"]);
async function loadCountries() {
  try {
    const response = await fetch("/data/african-stories-experience.json", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();
    for (const item of data.countries || []) country.add(new Option(item.name, item.code));
  } catch { status.textContent = "The country list could not be loaded. Please try again later."; }
}
function payloadFrom(data) {
  const year = String(data.get("year") || "").trim();
  return {
    title: String(data.get("title") || "").trim(),
    countryCode: String(data.get("countryCode") || "").trim().toUpperCase(),
    format: String(data.get("format") || "").trim(),
    year: year ? Number(year) : null,
    languages: String(data.get("languages") || "").split(",").map(value => value.trim()).filter(Boolean).slice(0, 12),
    submitterName: String(data.get("submitterName") || "").trim(),
    role: String(data.get("role") || "").trim(),
    email: String(data.get("email") || "").trim(),
    projectUrl: String(data.get("projectUrl") || "").trim(),
    note: String(data.get("note") || "").trim(),
    rightsDeclaration: data.get("rightsDeclaration") === "on",
    privacyConsent: data.get("privacyConsent") === "on"
  };
}
form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.textContent = "Sending your submission securely…";
  const payload = payloadFrom(new FormData(form));
  if (!FORMATS.has(payload.format) || !ROLES.has(payload.role)) {
    status.textContent = "Please check the format and your relationship to this title.";
    button.disabled = false;
    return;
  }
  try {
    const response = await fetch("/api/african-stories/submissions", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "The secure intake service is not available yet.");
    form.reset();
    status.textContent = "Submission received. Reference: " + String(result.reference || "pending") + ". This is an acknowledgement, not acceptance or a rights agreement.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Submission could not be sent. Please try again later.";
  } finally { button.disabled = false; }
});
loadCountries();