# Vivid Recall AI fallback (Cloudflare Worker)

This Worker provides optional Airforce-powered clue expansion for Vivid Recall. It does not use Firebase Cloud Functions or require Firebase Blaze. The Airforce API key stays server-side in a Cloudflare Worker secret.

## Deploy

From the repository root:

```sh
npx wrangler login
npx wrangler deploy --config cloudflare/wrangler.toml
npx wrangler secret put AIRFORCE_API_KEY --config cloudflare/wrangler.toml
```

When prompted, paste the **newly rotated** Airforce API key into the terminal prompt. Do not put the key in source code, Firebase Hosting files, GitHub, or chat. The deploy output will show the Worker URL.

## Model fallback order

Airforce's native cross-model fallback is used in a single request, to avoid spending the free tier's per-minute request allowance on separate model calls:

1. `glm-4.7-flash`
2. `gpt-oss-20b`
3. `llama-instant`
4. `rnj-1`

Airforce's model catalogue and account permissions can change. Confirm current model IDs and pricing in the dashboard or `GET /v1/models`. If a model is unavailable, Airforce should try the next configured fallback. Airforce's published Quickstart currently lists the Free plan at 1 request per minute (and 1,000 requests per day); this is account-wide request throttling, not four separate free requests. Multi-turn chat may therefore need a pause between AI replies, and Vivid falls back to local matching when rate-limited.

## Enable the browser integration

After deployment, copy the exact HTTPS Worker URL from Wrangler into `plotAiFallbackUrl` in `scripts/config.js`:

```js
plotAiFallbackUrl: "https://YOUR-DEPLOYED-WORKER-URL.workers.dev",
```

Replace the example with the exact URL Wrangler returns, then deploy Firebase Hosting as usual. The existing Firebase Hosting Content Security Policy already permits `*.workers.dev` connections. The Worker accepts requests only from the production Vivid Cinema origins and the local Firebase emulator origins.

If the URL is left empty, Vivid Recall remains fully functional with deterministic local matching and TMDB search.

## Security and behavior

- Set `AIRFORCE_API_KEY` using Wrangler secrets, never `[vars]`.
- The Worker validates the origin, bounds the request text, limits request frequency best-effort, and uses a bounded timeout.
- Configure an additional Cloudflare rate-limit rule for the Worker endpoint if it is publicly reachable.
- Vivid Recall is a multi-turn AI chat: it can ask one useful follow-up question, incorporate corrections and new clues, and suggest possible titles as the conversation develops.
- The browser verifies candidate titles against TMDB before rendering result cards. Model-generated titles alone are never treated as verified catalogue records.
- Each chat request sends only a bounded recent conversation window. If the Worker, Airforce, or all configured models fail, the chat explains the fallback and launches the existing local Recall search.
- The model's reply is conversational; the `clues` and `candidates` fields are structured search aids used by the UI.
