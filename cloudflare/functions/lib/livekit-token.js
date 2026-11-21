const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function createLiveKitAccessToken({
  apiKey, apiSecret, identity, roomName, displayName, role, now = Date.now()
}) {
  if (typeof apiKey !== "string" || !apiKey.trim() ||
      typeof apiSecret !== "string" || apiSecret.length < 16 ||
      typeof identity !== "string" || !identity.trim() || identity.length > 128 || /[\u0000-\u001f]/.test(identity) ||
      typeof roomName !== "string" || !/^vivid-[a-f0-9]{32}$/.test(roomName)) {
    throw new TypeError("LiveKit token configuration or identity is invalid.");
  }
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = {
    iss: apiKey,
    sub: identity,
    name: typeof displayName === "string" ? displayName.slice(0, 80) : "Vivid member",
    nbf: issuedAt - 5,
    iat: issuedAt,
    exp: issuedAt + 4 * 60 * 60,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishSources: ["microphone"],
      canSubscribe: true,
      canPublishData: true
    },
    metadata: JSON.stringify({ role: role === "host" ? "host" : "guest" })
  };
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned));
  return { token: unsigned + "." + base64Url(new Uint8Array(signature)), expiresAt: (issuedAt + 4 * 60 * 60) * 1000 };
}
