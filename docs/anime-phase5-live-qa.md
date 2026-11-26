# Phase 5 anime player live QA

This checklist is for real browser/device verification. Automated tests validate URL construction, ID selection, event normalization, local progress persistence and failover state; they cannot prove that a third-party cross-origin provider has a working stream for a particular episode.

Only use titles and streams that are authorized for distribution and playback.

## Catalogue and episode mapping

- [ ] Season 1 uses the expected AniList/MAL entry and local episode number.
- [ ] A season with a distinct AniList title resolves to that season's ID and starts at its local episode.
- [ ] A single AniList entry spanning multiple TMDB seasons receives the continuous global episode number.
- [ ] A short episode list from an unrelated/older season is rejected instead of being used for a later season.
- [ ] TMDB Specials (season 0) remain season 0 in TMDB fallback URLs; episode-only anime-native sources and Player 2 stay unavailable for that route.
- [ ] Anime movies use TMDB-compatible fallbacks, not episode-only anime routes.

## Player 1 provider checks

For every eligible source, record whether the actual episode starts, whether the selected Sub/Dub track is correct, and whether resume position is restored.

- [ ] VidPlus — AniList ID, Sub/Dub, saved progress.
- [ ] VidLink — MAL ID, Sub/Dub, saved progress and provider progress events.
- [ ] AnimeEmbed — AniList ID, Sub/Dub, versioned animeembed progress events.
- [ ] Vidy — AniList ID, Sub-only route, progress events.
- [ ] EmbedWave — TMDB fallback, Sub preference only.
- [ ] VidSrc — TMDB/IMDb fallback, Sub preference only.
- [ ] VidAPI — TMDB/IMDb fallback, Sub preference only.

## Player 2 checks

- [ ] AniXo
- [ ] AniLink
- [ ] MegaPlay
- [ ] Megavid
- [ ] MegaFlix
- [ ] Sub/Dub selection stays synchronized with Player 1.
- [ ] An iframe that fails or never loads advances to the next untried provider.
- [ ] A loaded provider page is not falsely reported as confirmed video playback.

## Playback state and devices

- [ ] AnimeEmbed and Vidy progress updates persist against the correct TMDB season/episode.
- [ ] Reopening the same episode restores a supported resume position.
- [ ] AnimeEmbed/Vidy progress is forwarded to Watch Room playback synchronization.
- [ ] Manual server switching works while the player is open.
- [ ] Fullscreen, autoplay permission, audio, and orientation work on Android mobile.
- [ ] Fullscreen, audio, and keyboard controls work on desktop.
- [ ] A failed provider never blocks the user from choosing another eligible source.

## Reporting results

Record the title, TMDB ID, season, episode, selected provider, Sub/Dub track, device/browser, and exact failure message. Do not mark a provider as verified based only on its iframe loading; confirm that the video actually plays and that progress changes.
