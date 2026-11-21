export function mountWatchRoomPlayerLayout({ slot, overlay, Observer = globalThis.IntersectionObserver, onPresentation = () => {} } = {}) {
  if (!slot || !overlay) {
    return { setActive() {}, focus() {}, destroy() {} };
  }

  let active = false;
  let floating = false;
  let destroyed = false;
  let observer = null;

  const setFloating = next => {
    const value = Boolean(next);
    if (floating === value) return;
    floating = value;
    overlay.classList.toggle("is-floating", value);
    slot.classList.toggle("is-floating", value);
    overlay.dataset.presentation = value ? "floating" : "inline";
    const returnButton = overlay.querySelector("#player-return-inline");
    if (returnButton) returnButton.hidden = !value;
    onPresentation({ floating: value });
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("vivid:watch-room-player-presentation", {
        detail: { floating: value }
      }));
    }
  };

  if (typeof Observer === "function") {
    observer = new Observer(entries => {
      if (!active || destroyed) return;
      const entry = entries.find(item => item.target === slot);
      if (!entry) return;
      const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
      // Hysteresis prevents the player flickering at the viewport boundary.
      if (!floating && ratio <= 0.12) setFloating(true);
      else if (floating && ratio >= 0.45) setFloating(false);
    }, { root: null, rootMargin: "0px", threshold: [0, 0.12, 0.45] });
  }

  const onScroll = () => {
    if (!active || destroyed || observer) return;
    const rect = slot.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const ratio = rect.height > 0 ? visibleHeight / rect.height : 0;
    if (!floating && ratio <= 0.12) setFloating(true);
    else if (floating && ratio >= 0.45) setFloating(false);
  };

  if (!observer) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  return {
    setActive(value) {
      if (destroyed) return;
      const next = Boolean(value);
      if (active === next) return;
      active = next;
      if (observer) {
        if (active) observer.observe(slot);
        else observer.unobserve(slot);
      }
      if (!active) setFloating(false);
      else if (!observer) onScroll();
    },
    focus() {
      if (!destroyed) slot.scrollIntoView?.({ behavior: "smooth", block: "center" });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      active = false;
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      setFloating(false);
    }
  };
}
