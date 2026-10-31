# FlixQuest resolver integration

**Status:** API v2 client and contract tests added. The public OpenAPI contract documents provider discovery and playback stream resolution, not an offline-download endpoint. The client deliberately exposes download options only if the API response explicitly supplies a direct `downloadUrl`/`download_url`, an affirmative `offlineDownload`/`offline_download` flag, and a direct video MIME type. Ordinary playback URLs, HLS/DASH manifests and stream-size estimates are never promoted to downloads.

## Configuration

Create the client with a verified HTTPS base URL:

```js
import { createFlixQuestApi } from "./flixquest-api.js";

const flixQuest = createFlixQuestApi({
  baseUrl: "https://YOUR-VERIFIED-FLIXQUEST-HOST"
});
```

The client appends `/api/v2` unless it is already present. It uses the documented GET paths `/providers`, `/providers/status`, `/stream-movie` and `/stream-tv`; it sends no cookies, rejects redirects and supports abort signals. Configure the host only after confirming the service owner authorizes your integration and the instance is live.

## Host candidates discovered in the public FlixQuest repository

- `https://scraper-1.flixquest.app`
- `https://scraper-2.flixquest.app`

These appear in repository configuration/migration documentation; they are not confirmed live instances or a grant of API access. The OpenAPI `servers` entry itself points only to local development. The FlixQuest README says the scraper backend is closed-source and directs integrators to `flixquestapp@gmail.com` for API access/support.

## Still required for real offline downloads

The public API contract returns playback streams and a stream-size estimate. It does not document offline-download authorization, direct file download URLs, durable link renewal, or an offline storage entitlement. Until the service returns the explicit offline fields described above (or provides a separate documented download endpoint), `getDownloadOptions` correctly returns no options. Do not pass a stream URL to the OPFS adapter merely because it plays.

The Vivid browser adapter currently supports direct video files only. HLS/DASH offline packaging, Android native storage, Electron main-process downloads, and end-to-end browser testing remain separate work. Do not claim the feature is complete until a permitted real movie and TV episode have been downloaded and played offline after network disconnection.
