# Anime playback provider matrix

This document records the provider contracts used by Vivid's anime Player 1 and Player 2 adapters. These are iframe integrations only: Vivid does not scrape provider pages, extract their media URLs, decrypt streams, or bypass DRM.

## Anime-native AniList / MAL providers

| Provider | Identity | Route used by Vivid | Notes |
|---|---|---|---|
| VidPlus | AniList ID | `/embed/anime/{anilistId}/{episode}?dub={true|false}` | Native anime route. Vivid currently starts sub by default. |
| VidLink | MAL ID | `/anime/{malId}/{episode}/sub?fallback=true` | Native anime route. Provider documents sub/dub and fallback to the alternate track. |
| AnimeEmbed | AniList ID | `/embed/ani/{anilistId}/{episode}?track=sub` | Documents sub/dub, resume start, server selection, next episode and an `animeembed` postMessage channel. |
| Vidy | AniList ID | `/anime/{anilistId}/{episode}` | Documents progress, autoplay, next episode and episode selector options. |
| Aniweeb | AniList ID | `/embed/ani/{anilistId}/{episode}?track=sub` | Provides a self-contained iframe player and an in-player server selector. Its broader JSON API docs recommend backend caching; Vivid uses the documented iframe endpoint only. |

## TMDB compatibility fallbacks

These are kept because Vivid already uses them, but they are not represented as native anime endpoints.

| Provider | Identity | Route | Compatibility note |
|---|---|---|---|
| VidAPI | TMDB / IMDb | `/embed/movie/{id}` or `/embed/tv/{id}/{season}/{episode}` | Official FAQ says anime endpoint support is coming soon. Vivid only tries the existing generic movie/TV route for TMDB-mapped anime. Domain allowlisting may be required. |
| EmbedWave | TMDB | `/embed/movie/{tmdbId}` or `/embed/tv/{tmdbId}/{season}/{episode}` | Official documentation describes movies and series, not a native anime route. Included as a best-effort fallback for anime records with TMDB IDs. |
| VidSrc | TMDB / IMDb | Existing movie/TV embed route | Generic fallback only; coverage for animated titles is not guaranteed. |

## Player 2 providers already in Vivid

The separate anime Player 2 remains independent and retains AniXo, AniLink, MegaPlay, Megavid and MegaFlix. Its existing tests cover route construction and invalid-ID rejection. Provider availability can change independently of Vivid releases.

## Runtime and reliability rules

- Prefer native AniList/MAL providers when the matching ID is available.
- Use TMDB compatibility providers only when a matching TMDB ID exists.
- Keep the iframe lazy until the viewer chooses playback.
- Validate both `event.source` and the exact provider origin before accepting postMessage data.
- Never treat iframe `load` as proof that a stream is actually playing.
- Keep manual server switching available; do not claim uptime or coverage without a real playback check.
- Use only sources and content that Vivid is authorized to distribute. Provider documentation does not itself grant content rights.

## Reference documentation

- VidAPI: https://vidapi.ru/api and https://vidapi.ru/faq
- EmbedWave: https://embedwave.cc/
- VidPlus: https://vidplus.to/
- VidLink: https://vidlink.pro/
- AnimeEmbed: https://animeembed.com/
- Vidy: https://www.vidy.st/
- Aniweeb: https://api.aniweeb.net/docs
