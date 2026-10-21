# Anime playback reliability

## Changes in this patch

- Resolve AniList and MyAnimeList identifiers independently so one metadata API being unavailable does not automatically remove all anime player options.
- Add bounded request timeouts and handle non-OK responses without breaking the watch page.
- Verify title similarity before trusting a search result, reducing incorrect ID-to-title mappings.
- Prefer exact normalized title matches while allowing common title suffix and punctuation variations.
- Keep metadata APIs separate from video sources: AniList and Jikan provide identity/catalogue data, not playable streams.

## Provider expansion policy

New streaming providers must pass a real episode-level smoke test and a rights/terms review before being enabled in the production player. Public aggregator APIs and open-source extraction projects are not automatically licensed to redistribute or embed every title they can resolve. Integrate official/licensed streaming availability and provider-approved embeds; do not treat an HTTP 200 or a loaded iframe as proof of playable content.

## Verification still required

Run `npm test` and `npm run check:syntax`, then test real episodes on desktop and mobile. Confirm title-to-ID mapping, season/episode correctness, audio track availability, provider playback, fallback behavior, and errors from upstream providers. Browser-side code cannot inspect media events inside arbitrary cross-origin iframes unless the provider exposes a supported messaging API.
