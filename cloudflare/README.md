# Vivid Cinema plot-search fallback (Cloudflare Worker)

This Worker lets Vivid silently fall back to OpenRouter when Firebase AI Logic/Gemini fails. It keeps the OpenRouter API key server-side and does not require users to sign in or require Firebase Blaze.

## One-time setup

1. In Cloudflare, open **Workers & Pages** and create a Worker named `vivid-cinema-plot-fallback`.
2. Deploy the contents of `plot-ai-worker.js` as the Worker entry point (or deploy this folder with Wrangler).
3. In the Worker settings, add a **Secret** named `OPENROUTER_API_KEY`. Paste the key there only; never put it in Vivid's browser files or GitHub.
4. Keep `OPENROUTER_MODEL` set to `openai/gpt-oss-20b:free` initially. Free model availability and quotas can change; choose another compatible model in Worker variables if needed.
5. Add a Cloudflare rate-limiting rule for the Worker endpoint. The code includes a small best-effort per-isolate throttle, but it is not a global abuse-prevention system.
6. Copy the deployed Worker HTTPS URL and set `plotAiFallbackUrl` in `scripts/config.js` to that URL, then deploy Firebase Hosting.

## Behavior

- Gemini remains the primary provider.
- OpenRouter is called only when the Gemini semantic request fails or times out.
- The Worker key is never sent to the browser.
- All model-suggested titles must still be verified against TMDB before they appear in results.
- If the Worker is unset, unavailable, rate-limited, or its model fails, Vivid continues with the existing TMDB catalogue fallback.
- The Worker allows browser requests only from the production Firebase Hosting origins and localhost development origins listed in the file. Add another exact origin only if you intentionally use it.
- OpenRouter usage is subject to the selected model's current availability, rate limits, and pricing. Keep provider limits enabled.

## Deploy with Wrangler

From the repository root, deploy using the dedicated config (this prevents Wrangler from treating the whole website as Worker assets):

```sh
npx wrangler deploy --config cloudflare/wrangler.toml
npx wrangler secret put OPENROUTER_API_KEY --config cloudflare/wrangler.toml
```

If your Cloudflare build settings currently run `npx wrangler deploy`, change the deploy command to `npx wrangler deploy --config cloudflare/wrangler.toml`. Do not deploy from the repository root without `--config`, and do not use the website root as the Worker assets directory.

When prompted for the secret, paste the OpenRouter key into the terminal prompt, not into source code or chat. Then copy the Worker URL into `scripts/config.js`.
