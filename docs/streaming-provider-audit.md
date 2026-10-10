# Vivid Cinema streaming-provider audit

Date: 2026-10-10

## Scope and limits

This is a documentation and code-level audit of Vivid Cinema's player integration. It does not establish real-time uptime, title availability, stream quality, or playback success for any third-party provider. Those require a live test with known titles on desktop and mobile browsers.

Vivid's player must only embed media the site is authorized to distribute or embed. The integration should not bypass DRM, access restrictions, or provider controls.

## Current providers

### 1. VidAPI (primary)
- Current base: `https://vaplayer.ru` (configured in `scripts/config.js`).
- Documented routes: `/embed/movie/{tmdb-or-imdb-id}` and `/embed/tv/{id}/{season}/{episode}`.
- Documented capabilities: `PLAYER_EVENT`, playback status/progress/duration, resume via `resumeAt` or `startAt`, subtitles, and player customization.
- Integration notes: keep origin allowlisting exact; validate the active iframe window, media type, title ID where available, and season/episode before persisting progress.
- Documentation: https://vidapi.ru/api

### 2. VidSrc
- Current base: `https://vidsrc.sh`.
- Documented routes: `/embed/movie/{id}`, `/embed/tv/{id}/{season}/{episode}`.
- Documented capabilities: `PLAYER_EVENT`, progress/resume via `startAt`, subtitle language selection, and JSON info endpoints that can report availability.
- Integration notes: use a documented current domain, pass saved progress through `startAt`, and use provider availability checks only as a hint—not as proof that the embedded player will start.
- Documentation: https://vidsrc.sh/vidsrc/docs/

### 3. VidLink
- Current base: `https://vidlink.pro`.
- Documented routes: `/movie/{tmdbId}`, `/tv/{tmdbId}/{season}/{episode}`, and `/anime/{malId}/{episode}/{subOrDub}`.
- Documented capabilities: `PLAYER_EVENT` with event/currentTime/duration/media identifiers, progress data, `startAt`, subtitle parameters, and customization.
- Integration notes: the documented event shape differs from VidAPI/VidSrc. Do not treat any arbitrary message from the VidLink origin as playback health.
- Documentation: https://vidlink.pro/

### 4. VidPlus
- Current base: `https://player.vidplus.to`.
- Documented routes in its public repository README: `/embed/movie/{tmdbId}`, `/embed/tv/{tmdbId}/{season}/{episode}`, and `/embed/anime/{aniListId}/{episode}`.
- Integration notes: route and ID formats differ by content type. Public README claims should be verified with real playback; this audit does not assume an undocumented event API is reliable.
- Documentation: https://github.com/vidbox1/vidplus

### 5. AVideo (candidate; not yet configured)
- Documentation: https://github.com/WWBN/AVideo/wiki/Video-Embed-URL-for-AVideo
- Embed route: `https://YOUR-AVIDEO-HOST/videoEmbed/VIDEO_ID` (also `/videoEmbeded/VIDEO_ID` and `/vEmbed/VIDEO_ID`).
- Documented options include autoplay, mute, controls, and `t=SECONDS`.
- Blocker: no AVideo host or video ID mapping was provided. TMDB IDs are not automatically AVideo video IDs. The actual host must also be explicitly permitted by the site's Content Security Policy `frame-src`. Therefore AVideo cannot be honestly enabled or tested from the documentation URL alone.
- AVideo's standard embed documentation does not establish a universal `PLAYER_EVENT` contract for every installation. Until confirmed, treat it as a provider with unknown progress-event support.

## Code-level findings

1. The existing watch page has a shared iframe and source buttons, but the providers do not share one universal URL or event contract.
2. The old event handler treated any object message from VidLink and VidPlus as a playback signal. This can incorrectly mark a failed player as healthy.
3. An iframe `load` event only confirms that an iframe document loaded; it does not prove the movie is playable.
4. Resume support was uneven across the alternate providers. The player URL builders now pass the saved position to VidSrc and VidLink using `startAt`, and to VidPlus using `startAt` when supported.
5. A same-page cinema mode has been added to give the embedded player a focused, near-full-viewport layout without opening a new tab or navigating away.
6. Cross-origin restrictions mean Vivid cannot force third-party player quality, subtitle, seek, or playback controls unless the provider exposes and documents a supported API.
7. Automatic fallback should be based on validated provider signals or an explicit availability check. A timer alone is a heuristic and can produce false positives on slow networks.

## Verification still required

- Test one movie and one TV episode on each configured provider.
- Confirm the provider emits the documented message format from the actual iframe origin.
- Confirm progress is saved to the right movie/episode and restored when switching sources.
- Test source switching while playing, paused, buffering, and after a provider error.
- Test Safari on iPhone, Android Chrome, desktop Safari/Chrome/Firefox, fullscreen, orientation changes, and returning from background.
- Confirm the actual AVideo host, sample video ID, embed permissions, and whether its installation emits usable parent-window events before enabling provider five.
