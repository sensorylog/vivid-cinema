# Anime playback reliability

## Changes in this patch

- Resolve AniList and MyAnimeList identifiers independently so one metadata API being unavailable does not automatically remove all anime player options.
- Add bounded request timeouts and handle non-OK responses without breaking the watch page.
- Verify title similarity before trusting a search result, reducing incorrect ID-to-title mappings.
- Use TMDB season title/year and AniList/Jikan episode counts to prefer season-specific anime IDs. When a single catalogue entry spans multiple TMDB seasons, convert the selected season/episode to its continuous episode number; reject a clearly incompatible short episode list instead of silently routing to the wrong season.
- Prefer exact normalized title matches while allowing common title suffix and punctuation variations.
- Keep metadata APIs separate from video sources: AniList and Jikan provide identity/catalogue data, not playable streams.

## Provider expansion

- Anime-native routes: VidPlus (AniList), VidLink (MAL), AnimeEmbed (AniList), and Vidy (AniList), subject to each provider's route and ID requirements.
- Compatibility fallbacks: EmbedWave (TMDB movie/TV route), VidSrc (TMDB/IMDb movie/TV route), and VidAPI (TMDB/IMDb movie/TV route). The latter three are not claimed to have dedicated anime endpoints.
- Aniweeb was removed from the active player because its availability and real episode playback could not be verified. Do not treat a documented URL as a confirmed working source.
- Player 1 uses a shared Sub/Dub preference across both anime players. VidPlus, VidLink, and AnimeEmbed receive the selected track; Vidy and generic TMDB fallbacks are not offered for Dub because their documented anime routes do not expose a dependable track selector.
- Player 1 validates AnimeEmbed channel/version and Vidy JSON-string progress messages, persists their progress events, and automatically advances to another eligible provider when a source times out without a healthy playback event.
- Player 2 automatically advances only when an iframe errors or never emits a load event. A cross-origin iframe load is not proof that a video started; if the provider page loads but the stream remains blank, the user still has manual server switching.
- AniList/Jikan are metadata resolvers, not playback sources. Other aggregators still need live episode, provider-terms, and security checks before production integration. AnimeEmbed and Vidy now have documented iframe adapters, but real episode playback still requires device verification.

## Verification still required

Automated regression and syntax checks are now passing in GitHub Actions. Live real-episode playback still needs desktop and mobile verification. Confirm title-to-ID mapping, season/episode correctness, Sub/Dub availability, provider playback, fallback behavior, and upstream errors. Aniweeb remains excluded. Vivid cannot inspect media events inside arbitrary cross-origin iframes unless the provider exposes a supported messaging API.

## Discovery catalogue scope

- The TMDB discovery catalogue currently uses the Animation genre plus Japanese original-language filtering. This reduces western-cartoon contamination, but it is not a complete global anime index: Chinese donghua, non-Japanese productions, and titles with incomplete TMDB language/genre metadata can be omitted.
- AniList autocomplete and the watch-page enrichment panel provide an additional anime-specific metadata layer, but they do not currently replace TMDB as the source of playback-compatible title IDs.
- Treat catalogue completeness as a remaining validation item before declaring Phase 4 finished.
