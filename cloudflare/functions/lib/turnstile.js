export async function verifyTurnstileToken(token, secret, expectedHostname, expectedAction, remoteIp = "") {
  if (typeof token !== "string" || !token || token.length > 2048) {
    const error = new Error("A valid Cloudflare Turnstile token is required.");
    error.code = "turnstile/invalid-token";
    throw error;
  }
  if (typeof secret !== "string" || !secret) {
    throw new Error("Cloudflare Turnstile is not configured.");
  }

  const body = new URLSearchParams({ secret, response: token });
  if (typeof remoteIp === "string" && remoteIp) body.set("remoteip", remoteIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      const error = new Error("Cloudflare Turnstile rejected the browser verification.");
      error.code = "turnstile/verification-failed";
      throw error;
    }
    if (
      typeof expectedHostname !== "string" ||
      result.hostname?.toLowerCase() !== expectedHostname.toLowerCase() ||
      result.action !== expectedAction
    ) {
      const error = new Error("Cloudflare Turnstile verification did not match this Vivid site.");
      error.code = "turnstile/claims-mismatch";
      throw error;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    const failure = new Error("Cloudflare Turnstile is temporarily unavailable.");
    failure.code = "turnstile/unavailable";
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}
