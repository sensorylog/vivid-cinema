/**
 * Native Notify — web push for React and Next.js (added by Agent Notify).
 *
 *   useNativeNotifyWebPush(options)   — the headless hook: supported,
 *                                       permission, subscribed, busy, error,
 *                                       enable(), disable(), refresh().
 *   <NativeNotifyWebPushButton … />   — a ready "Enable notifications" button.
 *
 * Both use native-notify-web-push.js (the service worker is
 * /native-notify-sw.js at the site root). Next.js App Router: this file's
 * "use client" directive makes it a client component — render it from a
 * server layout or page directly.
 *
 * TypeScript: the JSDoc types below are what a TypeScript project sees; only
 * appId and a credential are required (prefer webKey — the publishable web
 * key, safe in page source), and env values (string | undefined) are
 * accepted.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  disableNativeNotifyWebPush,
  enableNativeNotifyWebPush,
  ensureNativeNotifyWebPush,
  getWebPushState,
  isWebPushSupported,
} from "./native-notify-web-push.js";

/**
 * The credential the web helpers accept: webKey (preferred — safe in page
 * source) or appToken (kept working for existing sites). One of the two is
 * required; the type says the same as the runtime (`webKey || appToken`).
 * @typedef {{ webKey: string | null | undefined, appToken?: string | null | undefined } | { appToken: string | null | undefined, webKey?: string | null | undefined }} NativeNotifyWebCredential
 */

/**
 * Options for the hook. Only appId and a credential are required — prefer webKey.
 * @typedef {Object} NativeNotifyWebPushHookOptionsBase
 * @property {string | number | null | undefined} appId Your Native Notify app id (e.g. process.env.NEXT_PUBLIC_NN_APP_ID).
 * @property {string | null | undefined} [webKey] Your PUBLISHABLE WEB KEY (e.g. process.env.NEXT_PUBLIC_NN_WEB_KEY) — safe in page source.
 * @property {string | null | undefined} [appToken] Your Native Notify app token — kept working for existing sites; do not put it in page source.
 * @property {string | null | undefined} [subscriberId] Your own user id, to reach this person later by id.
 * @property {string | undefined} [serviceWorkerPath] Default "/native-notify-sw.js".
 * @property {string | undefined} [apiBase] Defaults to https://app.nativenotify.com.
 */

/** @typedef {NativeNotifyWebPushHookOptionsBase & NativeNotifyWebCredential} NativeNotifyWebPushHookOptions */

/**
 * What the hook returns.
 * @typedef {Object} NativeNotifyWebPush
 * @property {boolean} supported
 * @property {NotificationPermission | "unsupported" | "unknown"} permission
 * @property {boolean} subscribed
 * @property {boolean} busy
 * @property {string | null} error
 * @property {() => Promise<boolean>} enable Call from a click (browsers require a user gesture).
 * @property {() => Promise<boolean>} disable
 * @property {() => Promise<void>} refresh
 */

/**
 * @param {NativeNotifyWebPushHookOptions} options
 * @returns {NativeNotifyWebPush}
 */
export function useNativeNotifyWebPush(options) {
  const { appId, webKey, appToken, subscriberId, serviceWorkerPath, apiBase } = options || {};
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState(/** @type {NotificationPermission | "unsupported" | "unknown"} */ ("unknown"));
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    const state = await getWebPushState({ appId, webKey, appToken, serviceWorkerPath });
    setSupported(state.supported);
    setPermission(state.permission);
    setSubscribed(state.subscribed);
  }, [appId, webKey, appToken, serviceWorkerPath]);

  // Read the browser state once mounted (client-side only).
  useEffect(() => {
    setSupported(isWebPushSupported());
    refresh();
  }, [refresh]);

  const silentTried = useRef(false);
  // Silent re-register (2026-10-02): a granted browser that lost its
  // subscription can never come back through the prompt — re-register it
  // quietly (opt-outs and un-granted browsers are left alone; a click
  // retries visibly if this fails).
  useEffect(() => {
    if (!supported || permission !== "granted" || subscribed || silentTried.current) return;
    silentTried.current = true;
    let cancelled = false;
    (async () => {
      const result = await ensureNativeNotifyWebPush({ appId, webKey, appToken, subscriberId, serviceWorkerPath, apiBase });
      if (!cancelled && result.ok) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, appId, webKey, appToken, refresh, serviceWorkerPath, subscriberId, supported, permission, subscribed]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await enableNativeNotifyWebPush({ appId, webKey, appToken, subscriberId, serviceWorkerPath, apiBase });
    setBusy(false);
    if (!result.ok) setError(result.message || "Notifications could not be enabled.");
    await refresh();
    return result.ok;
  }, [apiBase, appId, webKey, appToken, refresh, serviceWorkerPath, subscriberId]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await disableNativeNotifyWebPush({ appId, webKey, appToken, serviceWorkerPath, apiBase });
    setBusy(false);
    if (!result.ok) setError(result.message || "Notifications could not be turned off.");
    await refresh();
    return result.ok;
  }, [apiBase, appId, webKey, appToken, refresh, serviceWorkerPath]);

  return { supported, permission, subscribed, busy, error, enable, disable, refresh };
}

/**
 * Props for <NativeNotifyWebPushButton />. Only appId and a credential are required (prefer webKey).
 * @typedef {Object} NativeNotifyWebPushButtonPropsBase
 * @property {string | number | null | undefined} appId
 * @property {string | null | undefined} [webKey] Your PUBLISHABLE WEB KEY — safe in page source.
 * @property {string | null | undefined} [appToken] Kept working for existing sites; not for page source.
 * @property {string | null | undefined} [subscriberId]
 * @property {string | undefined} [serviceWorkerPath]
 * @property {string | undefined} [apiBase]
 * @property {string | undefined} [enableLabel] Default "Enable notifications".
 * @property {string | undefined} [disableLabel] Default "Turn off notifications".
 * @property {string | undefined} [className]
 * @property {((subscribed: boolean) => void) | undefined} [onChange]
 */

/** @typedef {NativeNotifyWebPushButtonPropsBase & NativeNotifyWebCredential} NativeNotifyWebPushButtonProps */

/**
 * A button that turns web push on (and off) for this browser. Renders
 * nothing where web push is unsupported.
 * @param {NativeNotifyWebPushButtonProps} props
 */
export default function NativeNotifyWebPushButton({
  appId,
  webKey,
  appToken,
  subscriberId,
  serviceWorkerPath,
  apiBase,
  enableLabel = "Enable notifications",
  disableLabel = "Turn off notifications",
  className,
  onChange,
}) {
  const push = useNativeNotifyWebPush({ appId, webKey, appToken, subscriberId, serviceWorkerPath, apiBase });

  useEffect(() => {
    if (onChange) onChange(push.subscribed);
  }, [onChange, push.subscribed]);

  if (!push.supported) return null;
  const blocked = push.permission === "denied";
  return (
    <span className={["nn-web-push", className || ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="nn-web-push__button"
        disabled={push.busy || blocked}
        onClick={() => (push.subscribed ? push.disable() : push.enable())}
      >
        {push.subscribed ? disableLabel : enableLabel}
      </button>
      {(push.error || blocked) && (
        <span className="nn-web-push__error" role="status">
          {blocked ? "Notifications are blocked for this site in your browser settings." : push.error}
        </span>
      )}
    </span>
  );
}
