import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
let currentUser = null;
async function api(path, method = "GET", body) {
  if (!currentUser) throw new Error("Sign in with an administrator Vivid account.");
  const token = await currentUser.getIdToken();
  const response = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || (response.status === 403 ? "This account is not authorised for Anime Premium administration." : "The admin request could not be completed."));
  return payload;
}
function status(message, isError = false) {
  $("vap-admin-status").textContent = message;
  $("vap-admin-status").style.color = isError ? "#f1a6a6" : "#c6b2f5";
}
async function loadMemberships() {
  try {
    const payload = await api("/api/anime-premium/admin/memberships");
    const rows = payload.memberships || [];
    $("vap-admin-memberships").innerHTML = rows.length ? rows.map(item =>
      "<tr><td>" + escapeHtml(item.uid) + "</td><td>" + escapeHtml(item.status) + "</td><td>" +
      escapeHtml(item.renewalMode || "manual") + (item.autoRenew ? " · Auto" : "") + "</td><td>" +
      escapeHtml(item.currentPeriodEnd ? new Date(item.currentPeriodEnd).toLocaleDateString() : "—") + "</td></tr>"
    ).join("") : '<tr><td colspan="4">No Premium memberships found.</td></tr>';
    status("Administrator access verified · " + rows.length + " membership records loaded.");
  } catch (error) {
    $("vap-admin-memberships").innerHTML = '<tr><td colspan="4">' + escapeHtml(error.message) + '</td></tr>';
    status(error.message, true);
  }
}
async function submitMembership(event) {
  event.preventDefault();
  const payload = {
    uid: $("vap-admin-uid").value.trim(),
    action: $("vap-admin-action").value,
    days: Number($("vap-admin-days").value || 30),
    reason: $("vap-admin-reason").value.trim()
  };
  try {
    await api("/api/anime-premium/admin/memberships", "POST", payload);
    $("vap-admin-reason").value = "";
    status("Membership action recorded in the server audit log.");
    await loadMemberships();
  } catch (error) { status(error.message, true); }
}
async function submitSource(event) {
  event.preventDefault();
  const mediaType = $("vap-admin-media-type").value;
  const territories = $("vap-admin-territories").value.split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
  const licenseStart = new Date($("vap-admin-license-start").value);
  const licenseEnd = new Date($("vap-admin-license-end").value);
  if (!territories.length || territories.some(code => !/^[A-Z]{2}$/.test(code)) ||
      !Number.isFinite(licenseStart.getTime()) || !Number.isFinite(licenseEnd.getTime()) ||
      licenseEnd <= licenseStart || !$("vap-admin-rights-verified").checked) {
    status("Verify the licence, territory list and valid start/end dates before saving this provider source.", true);
    return;
  }
  const payload = {
    mediaType,
    titleId: $("vap-admin-title-id").value.trim(),
    scope: mediaType === "tv" ? $("vap-admin-source-scope").value : "title",
    season: mediaType === "tv" && $("vap-admin-source-scope").value === "episode" ? Number($("vap-admin-season").value || 1) : null,
    episode: mediaType === "tv" && $("vap-admin-source-scope").value === "episode" ? Number($("vap-admin-episode").value || 1) : null,
    provider: $("vap-admin-provider").value.trim(),
    candidateId: $("vap-admin-candidate-id").value.trim() || $("vap-admin-provider").value.trim(),
    priority: Number($("vap-admin-priority").value || 50),
    sourceId: $("vap-admin-source-id").value.trim(),
    allowedTerritories: territories,
    rightsReference: $("vap-admin-rights-reference").value.trim(),
    licenseStartsAt: licenseStart.toISOString(),
    licenseEndsAt: licenseEnd.toISOString(),
    rightsVerified: $("vap-admin-rights-verified").checked,
    active: $("vap-admin-source-active").checked
  };
  try {
    const result = await api("/api/anime-premium/admin/sources", "POST", payload);
    status("Authorised server candidate saved: " + (payload.candidateId || payload.provider) + " · " + result.sourceKey);
    $("vap-admin-source-id").value = "";
  } catch (error) { status(error.message, true); }
}
function bind() {
  $("vap-admin-refresh").addEventListener("click", loadMemberships);
  $("vap-admin-membership-form").addEventListener("submit", submitMembership);
  $("vap-admin-source-form").addEventListener("submit", submitSource);
  const updateSourceScope = () => {
    const isEpisode = $("vap-admin-media-type").value === "tv" && $("vap-admin-source-scope").value === "episode";
    $("vap-admin-season").disabled = !isEpisode;
    $("vap-admin-episode").disabled = !isEpisode;
    $("vap-admin-source-scope").disabled = $("vap-admin-media-type").value === "movie";
  };
  $("vap-admin-media-type").addEventListener("change", updateSourceScope);
  $("vap-admin-source-scope").addEventListener("change", updateSourceScope);
  updateSourceScope();
}
bind();
onAuthStateChanged(auth, user => {
  currentUser = user && !user.isAnonymous ? user : null;
  if (!currentUser) {
    status("Sign in with an administrator Vivid account to continue.", true);
    $("vap-admin-memberships").innerHTML = '<tr><td colspan="4">Authentication required.</td></tr>';
    return;
  }
  void loadMemberships();
}, error => status(error.message || "Vivid authentication is unavailable.", true));
