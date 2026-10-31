# Website offline downloads

Vivid's website uses the FlixQuest Scraper API v2 only to resolve movie and TV-episode stream links. Vivid owns the browser download queue, local storage, progress UI, and offline playback.

## Connect a resolver

1. Open **Offline Downloads** in Vivid.
2. Enter the HTTPS base URL for an accessible FlixQuest Scraper API v2 instance. Enter the instance root (for example, `https://scraper.example`), not an endpoint path.
3. Choose **Save & test connection**. Vivid checks `GET /api/v2/providers` and reloads after it finds enabled providers.
4. Return to a movie or TV title, choose **Download**, select a provider/server quality, and the download is added to the queue.

The public FlixQuest repository documents the client API but does not provide a hosted public service URL. Obtain access to an instance or self-host through the FlixQuest project. Do not put private API credentials in the browser URL.

The API URL is saved in this browser's local storage. It is not sent to Vivid's own backend.

## Supported website formats

- HLS VOD playlists: Vivid downloads the playlist resources into Origin Private File System (OPFS), rewrites the saved playlist to local object URLs, and plays it offline through hls.js or native HLS.
- Progressive video files: Vivid stores the file in OPFS and plays it from a local object URL.
- DASH, live HLS, encrypted/DRM streams, unsupported HLS features, embed pages, and resources on unapproved hosts are not downloaded by this first website implementation.

The website implementation does not bypass DRM or access controls. Use only media you have the right to store. A resolver returning a playable URL is not itself a legal authorization to download it.

## Browser requirements and limitations

- A secure HTTPS origin is required for the FlixQuest API and browser storage.
- The browser must support IndexedDB and Origin Private File System (OPFS).
- FlixQuest and the media host must allow browser CORS requests. The browser downloader does not proxy media through Vivid servers.
- Browser background tabs may be throttled or suspended. Closing the browser can interrupt an active transfer; interrupted queue entries are recovered as paused and can be restarted.
- Site data clearing, browser storage eviction, or device cleanup can remove offline media.
- HLS resources must remain on the hostnames returned by the resolver. Cross-host playlist references are rejected rather than fetched from arbitrary hosts.

## Troubleshooting

- **No providers found:** confirm the API URL and that at least one FlixQuest provider is enabled.
- **Network/CORS error:** verify the instance is reachable from the deployed Vivid origin and that its CORS policy permits that origin.
- **No download qualities:** the selected provider returned no HTTPS HLS or progressive stream link for that title/episode.
- **Download fails with HTML response:** the selected link resolved to an embed page or an upstream error page rather than media bytes.
- **Offline playback unavailable:** check browser OPFS support and the saved stream format.
