const LEGACY_PROFILE_CLASS = "vivid-performance-legacy";
const PERFORMANCE_STYLES_ATTRIBUTE = "data-vivid-performance-styles";

/**
 * Keep the legacy profile decision identical across browser and Electron.
 * Unknown capability values do not trigger a downgrade.
 */
export function isLegacyPerformanceDevice(capabilities = {}) {
  const cores = Number(capabilities.hardwareConcurrency || 0);
  const memory = Number(capabilities.deviceMemory || 0);
  return (cores > 0 && cores <= 2) || (memory > 0 && memory <= 4);
}

/**
 * Apply the established low-end visual profile without removing app features.
 * Safe to call more than once and safe when Electron preload ran first.
 */
export function applyPerformanceProfile({
  documentRef = document,
  navigatorRef = navigator
} = {}) {
  if (!isLegacyPerformanceDevice(navigatorRef)) return "standard";

  const root = documentRef.documentElement;
  if (!root) return "legacy";
  root.classList.add(LEGACY_PROFILE_CLASS);

  if (!documentRef.head || documentRef.querySelector(`[${PERFORMANCE_STYLES_ATTRIBUTE}]`)) {
    return "legacy";
  }

  const stylesheet = documentRef.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("../styles/vivid-performance.css", import.meta.url).href;
  stylesheet.setAttribute(PERFORMANCE_STYLES_ATTRIBUTE, "true");
  stylesheet.dataset.vividPerformanceStyles = "true";
  documentRef.head.appendChild(stylesheet);

  return "legacy";
}
