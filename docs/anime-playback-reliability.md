# Anime playback reliability

## Changes in this patch

- Resolve AniList and MyAnimeList identifiers independently so one metadata API being unavailable does not automatically remove all anime player options.
- Add bounded request timeouts and handle non-OK responses without breaking the watch page.
- Verify title similarity before trusting a search result, reducing incorrect ID-to-title mappings.
- Prefer exact normalized title matches while allowing common title suffix and punctuation variations.
- Keep metadata APIs separate from video sources: AniList and Jikan provide identity/catalogue data, not playable streams.

## Provider expansion

- VidPlus, VidLink, VidSrc, and VidAPI are the anime player choices, subject to the identifiers each provider requires.
- Aniweeb was removed from the active player because its availability and real episode playback could not be verified. Do not treat a documented URL as a confirmed working source.
- Anime source timeouts now trigger an automatic attempt at the next eligible source after 12 seconds; non-anime playback retains the existing manual fallback prompt.
- AniList/Jikan are metadata resolvers, not playback sources. Other aggregators still need live episode, provider-terms, and security checks before production integration.

## Verification still required

Run `npm test` and `npm run check:syntax`, then test real episodes on desktop and mobile. Confirm title-to-ID mapping, season/episode correctness, audio track availability, provider playback, fallback behavior, and errors from upstream providers. Aniweeb embed availability and playback still require live device verification; the code cannot inspect media events inside arbitrary cross-origin iframes unless the provider exposes a supported messaging API.
