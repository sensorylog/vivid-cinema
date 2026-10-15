/* Keep the Vivid mascot animation playing without requiring a tap.
   Autoplay is muted and inline; browsers may still defer playback until visible. */
(() => {
  const videos = document.querySelectorAll(".vivid-mascot-video");
  if (!videos.length) return;

  const start = (video) => {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");
    if (video.readyState === 0) video.load();

    const playback = video.play();
    if (playback && typeof playback.catch === "function") playback.catch(() => {
      // Some mobile browsers defer autoplay; visibility/readiness events retry.
    });
  };

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const video = entry.target;
          video.dataset.mascotVisible = String(entry.isIntersecting);
          if (entry.isIntersecting) start(video);
        }
      }, { rootMargin: "160px 0px", threshold: 0.01 })
    : null;

  videos.forEach((video) => {
    video.addEventListener("loadedmetadata", () => start(video));
    video.addEventListener("canplay", () => {
      if (video.paused) start(video);
    });
    video.addEventListener("pause", () => {
      if (!document.hidden && video.dataset.mascotVisible === "true") start(video);
    });
    if (observer) observer.observe(video);
    else start(video);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) videos.forEach((video) => {
      if (!observer || video.dataset.mascotVisible === "true") start(video);
    });
  });
})();
