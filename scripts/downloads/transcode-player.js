export function createTranscodePlayer(video) {
  let hls = null;
  let track = null;
  let statusTimer = null;
  let statusRequest = 0;

  function reset() {
    if (statusTimer !== null) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
    statusRequest++;
    if (hls) {
      try { hls.destroy(); } catch {}
      hls = null;
    }
    if (track) {
      try { track.remove(); } catch {}
      track = null;
    }
    delete video.dataset.transcodeDuration;
    delete video.dataset.transcodeSourceDuration;
    delete video.dataset.transcodeAvailableDuration;
    delete video.dataset.transcodeComplete;
    delete video.dataset.transcodeFailed;
    delete video.dataset.transcodeError;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function applyStatus(status) {
    const sourceDuration = Number(status?.sourceDuration);
    const availableDuration = Number(status?.availableDuration);
    if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
      video.dataset.transcodeSourceDuration = String(sourceDuration);
      video.dataset.transcodeDuration = String(sourceDuration);
    }
    if (Number.isFinite(availableDuration) && availableDuration >= 0) {
      video.dataset.transcodeAvailableDuration = String(availableDuration);
    }
    video.dataset.transcodeComplete = status?.complete === true ? "true" : "false";
    video.dataset.transcodeFailed = status?.failed === true ? "true" : "false";
    if (status?.failed) {
      video.dataset.transcodeError = String(status.error || "FFmpeg stopped before the movie was fully transcoded.");
      video.dispatchEvent(new Event("transcodestatuschange"));
    }
    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("transcodestatuschange"));
  }

  function startStatusPolling(session) {
    if (!session.statusUrl) return;
    const poll = async () => {
      const request = ++statusRequest;
      try {
        const response = await fetch(session.statusUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("Transcode status is unavailable.");
        const status = await response.json();
        if (request !== statusRequest) return;
        applyStatus(status);
        if (status.complete === true || status.failed === true) {
          if (statusTimer !== null) {
            window.clearInterval(statusTimer);
            statusTimer = null;
          }
        }
      } catch {
        // A transient status request failure must not interrupt an otherwise healthy stream.
      }
    };
    void poll();
    statusTimer = window.setInterval(poll, 1500);
  }

  function load(session) {
    reset();
    const sourceDuration = Number(session.sourceDuration ?? session.duration);
    if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
      video.dataset.transcodeSourceDuration = String(sourceDuration);
      video.dataset.transcodeDuration = String(sourceDuration);
    }
    video.dataset.transcodeAvailableDuration = "0";
    video.dataset.transcodeComplete = "false";
    video.dataset.transcodeFailed = "false";

    if (session.subtitleUrl) {
      track = document.createElement("track");
      track.kind = "subtitles";
      track.label = session.subtitle?.label || "English";
      track.srclang = "en";
      track.src = session.subtitleUrl;
      video.appendChild(track);
    }

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: 0,
        backBufferLength: 90,
        maxBufferLength: 30
      });
      hls.on(window.Hls.Events.LEVEL_UPDATED, (_event, data) => {
        const duration = Number(data?.details?.totalduration);
        if (Number.isFinite(duration) && duration >= 0) {
          video.dataset.transcodeAvailableDuration = String(duration);
          video.dispatchEvent(new Event("durationchange"));
        }
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else video.dispatchEvent(new Event("error"));
      });
      hls.loadSource(session.url);
      hls.attachMedia(video);
      startStatusPolling(session);
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = session.url;
      video.load();
      startStatusPolling(session);
      return;
    }
    throw new Error("This Windows build cannot play the transcoded HLS stream. Please update Vivid Cinema.");
  }

  return Object.freeze({ load, reset });
}
