# Anime playback reliability

## Changes in this patch

- Resolve AniList and MyAnimeList identifiers independently so one metadata API being unavailable does not automatically remove all anime player options.
- Add bounded request timeouts and handle non-OK responses without breaking the watch page.
- Verify title similarity before trusting a search result, reducing incorrect ID-to-title mappings.
- Prefer exact normalized title matches while allowing common title suffix and punctuation variations.
- Keep metadata APIs separate from video sources: AniList and Jikan provide identity/catalogue data, not playable streams.

## Provider expansion

- Added Aniweeb as an explicit episode-level iframe source using its documented AniList-ID route. It is available for anime series when an AniList ID resolves; sub is the default track.
- Enabled the existing VidSrc and VidAPI embed builders in anime mode as additional TMDB-ID fallbacks, instead of hiding them from anime viewers.
- The anime source order now tries Aniweeb first for series, then VidPlus, VidLink, VidSrc, and VidAPI where the required ID is available.
- AniList/Jikan remain metadata resolvers, not playback sources. The anime-sdk, Ani-API, and similar self-hosted extraction projects are not browser-only drop-ins: they require a trusted server runtime and proxy/security controls, so they are not silently enabled in static Firebase Hosting.

Public aggregator APIs and open-source extraction projects are not automatically licensed to redistribute or embed every title they can resolve. Provider terms/rights and live episode availability still need review; a loaded iframe is not proof that a stream plays.

## Verification still required

Run `npm test` and `npm run check:syntax`, then test real episodes on desktop and mobile. Confirm title-to-ID mapping, season/episode correctness, audio track availability, provider playback, fallback behavior, and errors from upstream providers. Aniweeb embed availability and playback still require live device verification; the code cannot inspect media inside arbitrary cross-origin iframes unless the provider exposes a supported messaging API. Browser-side code cannot inspect media events inside arbitrary cross-origin iframes unless the provider exposes a supported messaging API.
