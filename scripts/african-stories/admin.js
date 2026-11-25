import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { auth, app, ensureAppCheck } from "./firebase.js";

const state = document.getElementById("african-admin-state");
const controls = document.getElementById("african-admin-controls");
const action = document.getElementById("african-admin-action");
const payload = document.getElementById("african-admin-payload");
const result = document.getElementById("african-admin-result");
const submit = document.getElementById("african-admin-submit");
const format = document.getElementById("african-admin-format");
const functions = getFunctions(app, "us-central1");
const roles = {
  saveAfricanWorkDraft: "africanStoriesEditor",
  publishAfricanWork: "africanStoriesPublisher",
  registerAfricanProvider: "africanStoriesProviderAdmin",
  setAfricanRightsDecision: "africanStoriesRightsAdmin"
};
let availableClaims = {};

function showResult(value, isError = false) {
  result.hidden = false;
  result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  result.style.color = isError ? "#ffb4b4" : "#c8e6d2";
}

function updateActions() {
  for (const option of action.options) {
    option.disabled = availableClaims[roles[option.value]] !== true;
  }
  const enabled = [...action.options].some(option => !option.disabled && option.value === action.value);
  if (!enabled) {
    const first = [...action.options].find(option => !option.disabled);
    if (first) action.value = first.value;
  }
  submit.disabled = ![...action.options].some(option => !option.disabled);
}

onAuthStateChanged(auth, async user => {
  controls.hidden = true;
  availableClaims = {};
  if (!user) {
    state.textContent = "Sign in to a Vivid account assigned an African Stories operational role.";
    return;
  }
  try {
    await ensureAppCheck();
    const token = await user.getIdTokenResult(true);
    availableClaims = token.claims || {};
    const hasRole = Object.values(roles).some(claim => availableClaims[claim] === true);
    if (!hasRole) {
      state.textContent = "This account has no African Stories operational role. Ask a trusted Firebase administrator to assign the required claim.";
      return;
    }
    state.textContent = "Authenticated. Available actions are limited to the custom claims assigned to this account; the server independently checks every request.";
    controls.hidden = false;
    updateActions();
  } catch (error) {
    state.textContent = "Could not verify operational permissions. No actions are available.";
    console.warn("African Stories admin claim check failed:", error?.code || error?.message);
  }
});

action.addEventListener("change", updateActions);
format.addEventListener("click", () => {
  try { payload.value = JSON.stringify(JSON.parse(payload.value), null, 2); showResult("JSON formatted."); }
  catch { showResult("The request payload is not valid JSON.", true); }
});
submit.addEventListener("click", async () => {
  const functionName = action.value;
  if (availableClaims[roles[functionName]] !== true) {
    showResult("This account is not authorized for that operation.", true);
    return;
  }
  let data;
  try { data = JSON.parse(payload.value); }
  catch { showResult("The request payload is not valid JSON.", true); return; }
  submit.disabled = true;
  submit.textContent = "Working…";
  try {
    await ensureAppCheck();
    const operation = httpsCallable(functions, functionName);
    const response = await operation(data);
    showResult(response.data);
  } catch (error) {
    showResult({ code: error?.code || "unknown", message: error?.message || "Operation failed." }, true);
  } finally {
    submit.disabled = false;
    submit.textContent = "Run operation";
    updateActions();
  }
});
