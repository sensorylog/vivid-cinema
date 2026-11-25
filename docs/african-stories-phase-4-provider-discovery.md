# African Stories — Phase 4 provider discovery

**Status:** research register; candidates are not production-enabled.
**Branch:** `feat/african-stories-phases-2-7`
**PR:** #524 — all Phase 2–7 work remains in this single PR.

## Purpose

Identify real playback and catalogue integrations for the dedicated African Stories player. The target is a third player/provider ecosystem alongside Vivid's existing movie/TV and anime players. This register distinguishes:

1. a playback platform with a documented embed/player API;
2. a catalogue/discovery API that returns identifiers for a separate player;
3. an archive that exposes media files;
4. an African streaming service that requires a partner or title-level agreement.

A reachable URL is not automatically a stable provider, an authorized stream, or a reusable API. No undocumented stream extraction, DRM bypass, proxying of protected media, or scraping of private endpoints is part of this plan.

## High-priority provider candidates

### 1. YouTube IFrame Player API — first implementation candidate

- Official player API: https://developers.google.com/youtube/iframe_api_reference
- Embed format: `https://www.youtube.com/embed/VIDEO_ID`
- Supports play, pause, stop, seek, volume, player state events, captions and error events through the official IFrame API.
- A video can return error 101/150 when its owner disallows embedding; unavailable/private videos also fail.
- YouTube's policies require the standard player experience to remain intact. Do not hide/alter platform controls, suppress ads, remove attribution, offer background playback, or cache/download YouTube audiovisual content.
- A YouTube adapter should store a canonical video ID and creator/channel reference, construct only the documented embed URL, preserve YouTube branding/controls and provide a Watch on YouTube fallback.
- Treat official creator-channel uploads as the primary free African-film discovery route. Do not infer rights from a third-party catalogue listing alone; confirm the uploader/creator and title/version identity.

### 2. FilmFlux — African catalogue discovery API + YouTube playback

- Site: https://filmflux.app/
- Embed/API documentation: https://filmflux.app/embed
- Advertises a public, CORS-enabled, no-key trending endpoint:
  `GET https://filmflux.app/api/public/trending?limit=10`
- Documented response fields include title, description, thumbnail, duration, channel, YouTube ID and FilmFlux URL. Trending endpoint is documented as hourly cached and asks integrators to credit FilmFlux.
- Full catalogue and creator/actor data are advertised as enterprise access; contact listed on the provider's API page: partnerships@filmflux.app.
- Important: FilmFlux is a discovery/indexing integration, not a separate video CDN. Playback should use the returned YouTube ID with the YouTube IFrame API, not scrape FilmFlux's player or claim FilmFlux hosts the video.
- Validation before implementation: make a live request from the deployed server/browser environment, inspect response schema, test CORS and rate/usage terms, verify creator attribution and per-video YouTube embed availability. The public endpoint was documented by the provider page but could not be independently opened by the research browser in this pass.

### 3. PeerTube — federated video hosting and official embed API

- Embed API: https://docs.joinpeertube.org/api/embed-player
- REST API: https://docs.joinpeertube.org/api-rest-reference
- A PeerTube video is hosted by a particular instance. Its embed route is `/videos/embed/{videoUUID}`; the embed API supports play, pause, seek and player events.
- The REST API documents public video metadata and public Web Video/HLS file routes, plus an endpoint to check whether embedding is allowed.
- Build an instance-aware adapter. Keep the instance origin, video UUID, privacy, licence, embed permission and source attribution with the work/version record.
- Do not assume any random instance is durable. Maintain an allowlist of reviewed instances, monitor availability and respect instance terms, content licences and creator settings.

### 4. Internet Archive — archive file playback

- Help/documentation: https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide
- Archive items can expose browser-streamable media files; the format and codec determine whether the archive player can stream them.
- An item-specific file route can be used by the dedicated HTML5 media player only after validating that the file is publicly accessible, compatible, and permitted for the intended use.
- Archive metadata or public access does not by itself establish copyright status, commercial rights, or permission to redistribute. Preserve the item identifier, file identifier, source, licence/rights evidence and attribution.
- Test MP4/WebM and any documented HLS variant against real items; handle non-streamable formats without pretending they are playable.

### 5. Vimeo Player SDK — creator-hosted video

- Embed SDK: https://developer.vimeo.com/player/sdk/embed
- Supports player creation, playback events, time updates, seeking, volume, captions/audio tracks and other player controls.
- Videos can be unlisted or domain-restricted; unlisted embeds require the full URL including the privacy hash.
- Suitable for filmmaker, festival, distributor and archive partners who host material on Vimeo and authorize the Vivid domain.
- Requires per-video embed permission and domain/privacy validation; not a free public catalogue of African films.

## African discovery and partnership leads

### Wazi Movies

- https://wazimovies.africa/
- Public site describes itself as a free/legal African cinema catalogue whose films and series are hosted on official YouTube channels.
- The live site exposes country, language, title, creator/channel and YouTube thumbnail/video references across multiple African countries. The homepage itself reports 1,569 catalogue entries at the time inspected.
- Useful as a discovery/research lead and a source of official channel/title leads. No public API or data licence was verified in this pass. Do not scrape the catalogue or reuse its metadata at scale without permission. Follow each title to the creator's official channel and validate the YouTube video directly.

### NG-Movies

- https://ng-movies.com/
- Its public description says videos are uploaded by the respective copyright owners to YouTube and shown through standard YouTube APIs/player embeds; NG-Movies says it does not host the videos itself.
- Useful as a discovery lead for Ghanaian/Nigerian/African creator channels. No public developer API or permission to reuse its catalogue was verified.

### AfriDocs

- https://www.afridocs.net/
- Free African documentary streaming destination associated with Steps and the Bertha Foundation; published description says the catalogue is geo-blocked for Africa.
- Treat as a partner/platform lead, not an embed source until its operator confirms an embed/API or syndication arrangement. Test country access from target markets only through ordinary user-facing routes; do not bypass geo-restrictions.

### CINAF

- https://cinaf.tv/
- Creator/distributor-facing studio: https://studio.cinaf.tv/en
- Describes premium African cinema distribution, HD adaptive streaming/CDN, creator upload/encoding, territory windows and revenue reporting.
- High-value acquisition and provider partnership lead. No public playback API or embed SDK was found in this pass. Request technical documentation, approved-domain embedding, title-level rights and test credentials.

### FilmFlux and other YouTube cataloguers

- FilmFlux: https://filmflux.app/about and https://filmflux.app/embed
- FilmFlux says its indexed titles stream from official creator YouTube channels and documents a public trending API plus paid/enterprise catalogue access.
- This is a potentially scalable metadata lead, not a separate streaming server.

## Technical integration model

Use separate adapter classes/capabilities rather than forcing every provider through a single generic iframe contract:

| Adapter | Canonical locator | Playback mechanism | Required checks |
|---|---|---|---|
| YouTube | video ID + channel ID | Official IFrame Player API | public video, embed allowed, creator/source verified, API policy |
| PeerTube | instance origin + video UUID | Official embed API or documented public file/HLS route | instance allowlist, embed permission, privacy, licence, source health |
| Internet Archive | item ID + exact file name | HTML5 media element for supported public file | file exists, codec supported, rights/terms/attribution |
| Vimeo | video ID or full unlisted URL | Official Vimeo Player SDK | embed domain/privacy permission, creator authorization |
| Partner CDN (future) | partner work/version ID | Partner-specific HLS/DASH or signed playback session | contract, exact origin, short-lived token, territory/window, DRM if required |

Provider adapters should declare:
- `providerId`, adapter version, provider category and approved origins;
- supported locator formats and media types;
- player capabilities (play/pause/seek/timeupdate/subtitles/next episode);
- embed and domain restrictions;
- source health and error classification;
- official fallback URL;
- attribution and platform policy requirements.

The player should distinguish:
- `official_embed`: provider's official embed SDK/player (YouTube, Vimeo, PeerTube);
- `public_file`: an explicitly public media file that can be played in the HTML5 player (e.g. an eligible Internet Archive file);
- `partner_session`: a contracted provider's server-issued signed session or manifest.

This distinction is important: YouTube and Vimeo do not issue Vivid-specific five-minute playback tokens for ordinary public embeds. They need provider-specific, validated embed adapters; they must not be forced into a fake generic signed-session flow. Partner-hosted protected streams should continue to use server-issued sessions. The player should still close or clear any session it controls when the entitlement expires, but that client timer is not a claim that a public third-party URL itself expires.

## Next engineering sequence

1. Implement the YouTube adapter first: strict video ID parser, official embed/API lifecycle, player event mapping, embed-disabled handling, privacy-enhanced mode where appropriate, and official watch fallback.
2. Add FilmFlux as a discovery connector only after live endpoint/schema/CORS/terms validation; map returned YouTube IDs to YouTube playback records.
3. Implement PeerTube instance-aware embed support and instance health checks.
4. Implement Internet Archive item/file resolver with codec and rights metadata checks.
5. Add Vimeo partner-hosted embed support for creator-authorized titles.
6. Keep AfriDocs and CINAF in partnership discovery until written technical and usage permission is obtained.
7. Add integration tests with controlled fixture IDs and provider error fixtures; do not rely on a single successful iframe load event as proof that playback works.

## Evidence and limits

Research sources:
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference
- YouTube developer policies: https://developers.google.com/youtube/terms/developer-policies
- YouTube policy guide: https://developers.google.com/youtube/terms/developer-policies-guide
- PeerTube embed API: https://docs.joinpeertube.org/api/embed-player
- PeerTube REST API: https://docs.joinpeertube.org/api-rest-reference
- Internet Archive streaming guide: https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide
- Vimeo SDK: https://developer.vimeo.com/player/sdk/embed
- FilmFlux embed/API: https://filmflux.app/embed
- Wazi Movies: https://wazimovies.africa/
- NG-Movies: https://ng-movies.com/
- AfriDocs: https://www.afridocs.net/
- CINAF Studio: https://studio.cinaf.tv/en

This document records public technical documentation and discovery leads, not a legal opinion, partner confirmation, rights clearance, or a claim that any specific film is currently playable in Vivid. All production sources must be verified against the exact title/edition, territory, creator/uploader authority, embedding settings and provider terms.
