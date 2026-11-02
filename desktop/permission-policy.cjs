"use strict";

const ALLOWED_PERMISSIONS = new Set(["fullscreen", "media", "notifications"]);

function getHttpOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isPermissionAllowed({ permission, requestingUrl, currentUrl, allowedOrigins = [] } = {}) {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;

  const requestingOrigin = getHttpOrigin(requestingUrl);
  const currentOrigin = getHttpOrigin(currentUrl);
  if (!requestingOrigin || !currentOrigin || requestingOrigin !== currentOrigin) return false;

  const trustedOrigins = new Set(allowedOrigins.map(getHttpOrigin).filter(Boolean));
  return trustedOrigins.has(requestingOrigin);
}

module.exports = { isPermissionAllowed };
