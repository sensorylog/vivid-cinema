const CONTAINERS = Object.freeze({
  mp4: { label: "MP4", mime: "video/mp4" },
  m4v: { label: "MP4", mime: "video/mp4" },
  mov: { label: "QuickTime", mime: "video/quicktime" },
  mkv: { label: "Matroska", mime: "video/x-matroska" },
  webm: { label: "WebM", mime: "video/webm" },
  avi: { label: "AVI", mime: "video/x-msvideo" },
  wmv: { label: "Windows Media", mime: "video/x-ms-wmv" },
  mpg: { label: "MPEG", mime: "video/mpeg" },
  mpeg: { label: "MPEG", mime: "video/mpeg" },
  ts: { label: "MPEG transport stream", mime: "video/mp2t" },
  m2ts: { label: "MPEG transport stream", mime: "video/mp2t" },
  ogv: { label: "Ogg video", mime: "video/ogg" },
  "3gp": { label: "3GPP", mime: "video/3gpp" }
});

const VIDEO_PROFILES = Object.freeze([
  { id: "h264", label: "H.264 / AVC", contentType: 'video/mp4; codecs="avc1.640028"' },
  { id: "hevc", label: "H.265 / HEVC", contentType: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
  { id: "vp9", label: "VP9", contentType: 'video/webm; codecs="vp09.00.41.08"' },
  { id: "av1", label: "AV1", contentType: 'video/mp4; codecs="av01.0.08M.08"' }
]);

const AUDIO_PROFILES = Object.freeze([
  { id: "aac", label: "AAC", contentType: 'audio/mp4; codecs="mp4a.40.2"' },
  { id: "opus", label: "Opus", contentType: 'audio/webm; codecs="opus"' },
  { id: "flac", label: "FLAC", contentType: 'audio/flac; codecs="flac"' },
  { id: "ac3", label: "Dolby Digital (AC-3)", contentType: 'audio/mp4; codecs="ac-3"' },
  { id: "eac3", label: "Dolby Digital Plus (E-AC-3)", contentType: 'audio/mp4; codecs="ec-3"' }
]);

export function getContainerInfo(filename) {
  const name = String(filename || "").trim();
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  if (!match) return { extension: "", label: "Unknown container", mime: "" };
  const extension = match[1].toLowerCase();
  const known = CONTAINERS[extension];
  return known
    ? { extension, ...known }
    : { extension, label: extension.toUpperCase() + " (unrecognised)", mime: "" };
}

function basicSupport(video, contentType) {
  try {
    const value = video?.canPlayType?.(contentType) || "";
    return value === "probably" || value === "maybe" ? value : "no";
  } catch {
    return "unknown";
  }
}

async function capabilityDetail(mediaCapabilities, kind, contentType) {
  if (typeof mediaCapabilities?.decodingInfo !== "function") return null;
  const config = kind === "video"
    ? { type: "file", video: { contentType, width: 1920, height: 1080, bitrate: 8000000, framerate: 30 } }
    : { type: "file", audio: { contentType, channels: "2", bitrate: 192000, samplerate: 48000 } };
  try {
    const result = await mediaCapabilities.decodingInfo(config);
    return {
      supported: Boolean(result.supported),
      smooth: typeof result.smooth === "boolean" ? result.smooth : null,
      powerEfficient: typeof result.powerEfficient === "boolean" ? result.powerEfficient : null
    };
  } catch {
    return null;
  }
}

export async function probePlaybackCapabilities({
  video,
  mediaCapabilities = globalThis.navigator?.mediaCapabilities,
  userAgent = globalThis.navigator?.userAgent || "Unknown",
  platform = globalThis.navigator?.platform || "Unknown"
} = {}) {
  const probe = async (profile, kind) => {
    const canPlayType = basicSupport(video, profile.contentType);
    const mediaCapabilitiesResult = await capabilityDetail(mediaCapabilities, kind, profile.contentType);
    return {
      id: profile.id,
      label: profile.label,
      canPlayType,
      mediaCapabilities: mediaCapabilitiesResult,
      supported: mediaCapabilitiesResult?.supported ?? (canPlayType !== "no" && canPlayType !== "unknown")
    };
  };
  const [videoProfiles, audioProfiles] = await Promise.all([
    Promise.all(VIDEO_PROFILES.map(profile => probe(profile, "video"))),
    Promise.all(AUDIO_PROFILES.map(profile => probe(profile, "audio")))
  ]);
  return {
    engine: "Chromium HTMLMediaElement",
    userAgent: String(userAgent),
    platform: String(platform),
    videoProfiles,
    audioProfiles,
    note: "Codec checks are device capability estimates, not a scan of the currently loaded file."
  };
}

export function describeLoadedMedia(video, filename = "") {
  const container = getContainerInfo(filename);
  const duration = Number(video?.duration);
  const width = Number(video?.videoWidth) || 0;
  const height = Number(video?.videoHeight) || 0;
  return {
    filename: String(filename || "Unknown file"),
    container,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
    width,
    height,
    resolution: width && height ? width + " × " + height : "Not available",
    codec: "Not exposed by the browser for this local file"
  };
}
