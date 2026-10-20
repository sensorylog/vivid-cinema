/**
 * Native Notify — your app's PUBLIC settings (written by Agent Notify).
 *
 * Both values are public by design, so this file is safe to commit and safe in
 * page source:
 *   - the app id only names your app;
 *   - the web key is the PUBLISHABLE key — it can register this browser and
 *     read this browser's own inbox, and it can never send a notification.
 * Your app TOKEN (the key that can send) never belongs in website code.
 *
 * Nothing to set in Vercel / Netlify: the setup imports these two values.
 * If you ever regenerate the web key (Native Notify → Keys), ask Agent Notify to
 * update NN_WEB_KEY here — or paste the new key in.
 */

/** @type {number} */
export const NN_APP_ID = 33997;

/** @type {string} */
export const NN_WEB_KEY = "nnweb_17fddb48834e82ae4a61b6338aea1b74840941721bbfec2d";
