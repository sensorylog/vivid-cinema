import {
  profileErrorResponse, profileOptionsResponse, updateAccountProfile, validateProfileOrigin
} from "../../lib/profile-service.js";
import { jsonResponse } from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return profileOptionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestPatch({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    const profile = await updateAccountProfile(request, env);
    return jsonResponse({ ok: true, profile }, 200, origin, env);
  } catch (error) {
    return profileErrorResponse(error, origin, env);
  }
}
