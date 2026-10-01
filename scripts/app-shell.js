const MOBILE_BREAKPOINT = 768;

export function initAppShell() {
  document.documentElement.dataset.vividReady = "true";

  const updateViewport = () => {
    document.documentElement.dataset.viewport =
      window.innerWidth <= MOBILE_BREAKPOINT ? "mobile" : "desktop";
  };

  updateViewport();
  window.addEventListener("resize", updateViewport, { passive: true });
}
