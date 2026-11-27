import {
  createAccountProfile, listAccountProfiles, profileErrorResponse,
  profileOptionsResponse, validateProfileOrigin
} from "../../lib/profile-service.js";
import { jsonResponse } from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return profileOptionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    const result = await listAccountProfiles(request, env);
    return jsonResponse({ ok: true, ...result }, 200, origin, env);
  } catch (error) {
    return profileErrorResponse(error, origin, env);
  }
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    const profile = await createAccountProfile(request, env);
    return jsonResponse({ ok: true, profile }, 201, origin, env);
  } catch (error) {
    return profileErrorResponse(error, origin, env);
  }
}
