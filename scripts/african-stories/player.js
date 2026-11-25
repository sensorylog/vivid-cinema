import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { auth, app, ensureAppCheck } from "../firebase.js";

const state = document.getElementById("african-player-state");
const frame = document.getElementById("african-authorized-frame");
const title = document.getElementById("african-player-title");
const description = document.getElementById("african-player-description");
const params = new URLSearchParams(window.location.search);
const workId = params.get("work");
const versionId = params.get("version");
const functions = getFunctions(app, "us-central1");

function showState(heading, message) {
  frame.hidden = true;
  frame.removeAttribute("src");
  state.hidden = false;
  state.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "african-state-mark";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◇";
  const h2 = document.createElement("h2");
  h2.textContent = heading;
  const p = document.createElement("p");
  p.textContent = message;
  state.append(icon, h2, p);
}

function friendlyError(error) {
  if (error?.code === "functions/unauthenticated") return "Sign in to Vivid Cinema before requesting an authorized playback session.";
  if (error?.code === "functions/failed-precondition") return "No licensed Vivid playback route is currently enabled. This edition may still have an archive record or an official external viewing route.";
  if (error?.code === "functions/permission-denied") return "This edition is not cleared for playback in the verified territory or rights window.";
  if (error?.code === "functions/not-found") return "No licensed Vivid playback route is registered for this exact edition.";
  return "Vivid could not verify an authorized playback route. The player has remained closed.";
}

async function requestPlayback(user) {
  if (!workId || !versionId) {
    showState("Edition not specified", "Open this page from an African Stories work page with an exact edition selected.");
    return;
  }
  if (!user) {
    showState("Sign-in required", "Sign in to Vivid Cinema, then return to this exact edition to request playback.");
    description.textContent = "Playback requests require a signed-in Vivid account and a verified rights decision.";
    return;
  }
  try {
    await ensureAppCheck();
    const createSession = httpsCallable(functions, "createAfricanPlaybackSession");
    const result = await createSession({ workId, versionId });
    const playback = result.data?.playback;
    if (playback?.type !== "iframe" || typeof playback.url !== "string" || typeof playback.origin !== "string") {
      throw new Error("The playback service returned an invalid adapter response.");
    }
    const url = new URL(playback.url);
    if (url.protocol !== "https:" || url.origin !== playback.origin || url.username || url.password) {
      throw new Error("The playback route failed client-side origin validation.");
    }
    title.textContent = "Authorized edition";
    description.textContent = "A short-lived playback session was issued for this exact edition.";
    state.hidden = true;
    frame.src = url.toString();
    frame.title = "Authorized African Stories edition";
    frame.hidden = false;
  } catch (error) {
    console.warn("African Stories playback request was denied:", error?.code || error?.message);
    showState("Playback unavailable", friendlyError(error));
  }
}

onAuthStateChanged(auth, user => { requestPlayback(user); });
