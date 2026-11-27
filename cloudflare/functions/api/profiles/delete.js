import {
  deleteAccountProfile, profileErrorResponse, profileOptionsResponse, validateProfileOrigin
} from "../../lib/profile-service.js";
import { jsonResponse } from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return profileOptionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestDelete({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    const result = await deleteAccountProfile(request, env);
    return jsonResponse({ ok: true, ...result }, 200, origin, env);
  } catch (error) {
    return profileErrorResponse(error, origin, env);
  }
}
