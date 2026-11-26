# VIVID ANIME PREMIUM — Third-Party Streaming Provider Research

**Status:** Phase 4 provider integration  
**Last reviewed:** 26 November 2026  
**Integration model:** Cross-origin iframe players, matching the existing VIVID Cinema streaming architecture

## What this work is for

This is the server model the VIVID team requested: the external player/embed providers already used by VIVID Cinema, plus additional anime-capable embed providers. This is **not** a commercial Crunchyroll/HIDIVE partner API project and it is not a raw HLS scraper.

Premium playback now:
1. Verifies the signed-in Firebase user and active VIVID Anime Premium membership through `/api/anime-premium/playback`.
2. Creates a short-lived, user-owned playback session.
3. Resolves public catalogue identifiers (TMDB, AniList and MAL) for the selected title/season.
4. Builds the selected provider's documented iframe URL.
5. Embeds that provider inside the Premium player.
6. Switches to another provider when a provider reports a playback error, fails to become ready where it supports events, or the viewer chooses another server.

The iframe remains cross-origin. VIVID does not scrape the provider's page, extract its raw stream URL, or attempt to bypass its player.

## Provider roster

The registry contains **13 selectable provider endpoints**. Some are separate endpoint generations for the same provider; the user sees each as a distinct fallback choice.

| Provider | Catalogue key | Implemented route | Notes |
|---|---|---|---|
| **VidPlus** | AniList | `/embed/anime/{anilistId}/{episode}` | Existing VIVID anime source; sub/dub selection |
| **VidLink** | MAL | `/anime/{malId}/{episode}/{subOrDub}` | Existing VIVID anime source; documented fallback between audio variants |
| **VidSrc** | TMDB | `/embed/movie/{tmdbId}` or `/embed/tv/{tmdbId}/{season}/{episode}` | Existing VIVID Anime fallback; generic TMDB route rather than a dedicated MAL/AniList endpoint |
| **AniXo** | AniList or MAL | `/embed/ani/{id}/{episode}` or `/embed/mal/{id}/{episode}` | Claims multi-engine failover; emits player events |
| **AniLink** | AniList | `/watch/{anilistId}/{episode}?variant=sub|dub` | Public player event contract includes progress and error events |
| **MegaPlay** | AniList or MAL | `/stream/ani/{id}/{episode}/{subOrDub}` or `/stream/mal/...` | Current documented domain; progress/error events |
| **MegaPlay Legacy** | AniList or MAL | Existing VIVID `ani.megaplay.su` route | Retained as a separate fallback for compatibility with the current VIVID Anime player |
| **Megavid** | AniList or MAL | `/ani/{id}/{episode}/{subOrDub}` or `/mal/...` | Progress, complete and error messages |
| **MegaFlix** | AniList or MAL | `/stream/ani/{id}/{episode}/{subOrDub}` or `/stream/mal/...` | Progress, complete and error messages |
| **VidAPI** | TMDB | `/embed/movie/{tmdbId}` or `/embed/tv/{tmdbId}/{season}/{episode}` | Existing VIVID provider; generic movie/TV route, not a dedicated anime API |
| **EmbedWave** | TMDB | `/embed/movie/{tmdbId}` or `/embed/tv/{tmdbId}/{season}/{episode}` | Existing VIVID provider; built-in multi-server selector |
| **VidFast** | TMDB | `/embed/movie/{tmdbId}` or `/embed/tv/{tmdbId}/{season}/{episode}` | Existing VIVID movie/TV provider; usable for anime titles indexed in its TMDB catalogue |
| **VidRift** | AniList or TMDB | `/embed/anilist/{anilistId}/{episode}`, `/embed/tv/{tmdbId}/{season}/{episode}`, or movie route | New research addition; claims multiple sources, automatic failover and progress events |

### Why these were selected

- **VidAPI** documents TMDB/IMDb movie and TV embed endpoints, including a season/episode route. It does not document a separate MAL/AniList anime endpoint, so VIVID uses the TMDB route only when the anime title is represented in its catalogue.
- **EmbedWave** documents the same TMDB movie/series route shapes and a built-in multi-server dropdown. It is included because it is already part of VIVID Cinema's provider set.
- **VidLink** explicitly documents its anime route using a MAL ID, episode number and sub/dub path.
- **VidSrc** is retained because the existing VIVID Anime watch flow already uses its TMDB movie/TV embed route for anime titles represented in TMDB. It is not treated as a dedicated MAL/AniList anime endpoint.
- **AniLink** documents an AniList episode route, requires an explicit audio variant and publishes a validated `postMessage` event contract.
- **AniXo** documents both AniList and MAL embed routes, as well as its claimed multi-engine failover.
- **MegaPlay, Megavid and MegaFlix** document MAL/AniList anime routes and iframe player events. MegaPlay's current public API documentation uses `megaplay.buzz/stream/...`; VIVID also retains its older `ani.megaplay.su` endpoint as a compatibility fallback. MegaPlay's docs warn that not every title is mapped to MAL/AniList. They document a separate Anikoto catalogue API (`recent-anime` then `series/{id}`) that returns episode embed IDs, but explicitly recommend server-side use and document rate limits. Premium currently uses the documented MAL/AniList iframe routes; a future Anikoto catalog adapter should be added only after its response schema and title-matching behavior are validated server-side.
- **VidRift** documents TMDB and AniList routes, a multi-source player with automatic failover, and progress/error messages.
- **VidFast** documents TMDB/IMDb movie and TV routes. It is a generic catalogue fallback, not an anime-specific ID provider.

## Source documentation

- VidAPI embed API: https://vidapi.ru/api
- EmbedWave player and route reference: https://embedwave.cc/
- VidLink player documentation: https://vidlink.pro/
- VidPlus anime player: https://player.vidplus.to/
- VidSrc embed player: https://vidsrc.sh/
- AniLink introduction: https://anilink.cc/docs
- AniLink embed parameters: https://anilink.cc/docs/embed-parameters
- AniLink player events: https://anilink.cc/docs/player-events
- AniXo embed/API reference: https://anixo.buzz/
- MegaPlay embed API: https://megaplay.buzz/api
- Anikoto catalogue API used by MegaPlay: https://anikotoapi.site/
- MegaPlay legacy player: https://ani.megaplay.su/
- Megavid embed API: https://megavid.buzz/
- MegaFlix embed API: https://megaflix.buzz/
- VidFast embed API: https://vidfast.to/
- VidRift routes and player messages: https://vidrift.net/docs/

## Catalogue ID and episode mapping

The Premium catalogue is TMDB-backed. The watch page resolves AniList and MAL IDs through VIVID's existing `scripts/playback/anime-id-resolver.js` module.

- TMDB-based providers receive the selected TMDB title ID and the exact TMDB season/episode numbers.
- AniList-based providers receive the AniList ID and episode number.
- MAL-based providers receive the MAL ID and episode number.
- For later seasons, VIVID attempts a season-specific ID lookup. If the same series ID is reused, it calculates the cumulative episode offset from preceding TMDB seasons. This is a best-effort mapping: anime catalogues can split cours/sequels differently, and a provider may not have indexed every title or season.
- Sub/dub is explicit wherever the provider exposes a documented audio variant. A provider that does not support the requested variant may fail and be skipped.

A provider is shown as available only when the required catalogue identifier is present. Anime films use the TMDB movie endpoints for VidAPI, EmbedWave, VidFast and VidRift; episode-only providers are not shown as usable movie sources.

## Failover and progress behavior

- The player keeps a priority-ordered provider list and allows manual source switching.
- Providers with documented readiness/error events can trigger automatic failover when they report an error or do not report readiness within 18 seconds.
- Providers without a public event contract are not assumed to be playing merely because the iframe's document loaded. VIVID exposes a manual **Try next server** action after the initial load window instead of falsely claiming that cross-origin playback was verified.
- The message handler validates both `event.origin` and `event.source` against the currently active iframe before accepting progress or failure events.
- Progress is saved through the existing Premium progress endpoint only when the provider supplies a valid current-time and duration pair. VIVID does not invent watch progress for providers that expose no events.
- A provider outage does not break the rest of the player. The viewer can move through the remaining available options.

## Important limits

The provider's public documentation establishes route formats and claimed player features, not a guaranteed uptime SLA or successful playback for every title. A route may return a player shell while the selected anime episode is missing, region-blocked, or unavailable upstream. Actual success must be measured per title and territory during QA.

The Premium membership gate protects the VIVID Premium watch route and creates a VIVID playback session. It cannot make a third-party provider enforce VIVID membership inside that provider's own iframe. The upstream player remains operated by that third party.

Only use these embeds for content VIVID has the right to make available in its target markets. This integration does not validate the upstream content rights, and no provider is represented as a commercial partner of VIVID. Do not add raw-stream extraction, mirror scraping, DRM circumvention or hidden-source bypasses.

## Phase 4 QA checklist

- [ ] Test a representative current-season anime episode on every enabled provider.
- [ ] Validate whether a server-side Anikoto catalogue lookup improves MegaPlay coverage for titles not mapped to MAL/AniList; do not call the API directly from the browser.
- [ ] Test a long-running series, a sequel/cour split and a special episode to validate ID and episode-number mapping.
- [ ] Test sub and dub separately; do not infer dub availability from a successful sub stream.
- [ ] Test at least one anime film through each TMDB movie provider.
- [ ] Test provider-reported error and timeout failover on mobile and desktop.
- [ ] Test manual source switching when an iframe loads but its video does not start.
- [ ] Confirm AniLink, AniXo, MegaPlay, Megavid, MegaFlix and VidRift progress messages are origin-checked and saved correctly.
- [ ] Confirm providers without progress events do not create fake Continue Watching progress.
- [ ] Test the Premium gate for signed-out, expired and active members.
- [ ] Verify that account changes and expired playback sessions remove the active iframe.

**No uptime claim is made until live title-by-title playback QA has been completed.**
