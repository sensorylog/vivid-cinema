export function createTranscodePlayer(video) {
  let hls = null;
  let track = null;

  function reset() {
    if (hls) {
      try { hls.destroy(); } catch {}
      hls = null;
    }
    if (track) {
      try { track.remove(); } catch {}
      track = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function load(session) {
    reset();
    if (session.subtitleUrl) {
      track = document.createElement("track");
      track.kind = "subtitles";
      track.label = session.subtitle?.label || "English";
      track.srclang = "en";
      track.src = session.subtitleUrl;
      track.default = true;
      video.appendChild(track);
      track.addEventListener("load", () => {
        try { track.track.mode = "showing"; } catch {}
      }, { once: true });
    }

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30
      });
      hls.loadSource(session.url);
      hls.attachMedia(video);
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = session.url;
      video.load();
      return;
    }
    throw new Error("This Windows build cannot play the transcoded HLS stream. Please update Vivid Cinema.");
  }

  return Object.freeze({ load, reset });
}
