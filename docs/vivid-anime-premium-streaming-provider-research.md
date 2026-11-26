# VIVID ANIME PREMIUM — Streaming Provider Research & Integration Plan

**Status:** Phase 4 research / integration design  
**Scope:** Lawful provider discovery, rights acquisition, playback integration and operational controls  
**Last reviewed:** 26 November 2026

## Executive decision

VIVID should operate a **rights-cleared, multi-provider playback layer**, not a list of public video-hosting sites. A provider is eligible only when VIVID has a contract, licence, written integration permission, or an official API/SDK whose terms expressly permit the intended use.

There is no safe basis for treating a consumer subscription, public website, iframe, exposed manifest, or an unofficial third-party endpoint as permission for VIVID to retransmit that provider's catalogue. Provider discovery and licensing are therefore part of Phase 4, while payment, entitlement and admin commercial workflows remain Phase 5.

The current architecture already has the right starting boundary:
- VIVID's server-side source registry maps a title/episode to an authorised provider source ID.
- The Cloudflare playback endpoint verifies the signed-in user and active membership.
- A server-only resolver credential resolves the source ID into a short-lived HTTPS playback URL.
- The server checks the final hostname against `ANIME_PREMIUM_STREAM_HOSTS`.
- The browser receives only a short-lived session and supports HLS or MP4; it never chooses an unverified source.

The next provider integrations should plug into this resolver contract. Do not put provider secrets, partner credentials, or durable origin URLs in browser code or Firestore client-readable documents.

## Provider landscape — candidates, not claimed integrations

| Candidate | Why it is relevant | Integration position |
|---|---|---|
| **Crunchyroll** | Major global anime distributor with a substantial licensed catalogue and distribution partnerships. | High-priority partnership/licensing approach. Its published terms expressly prohibit incorporating, streaming or retransmitting its content through another application, or indexing significant portions of its catalogue, without express written authorisation. A normal Crunchyroll user subscription is not an integration licence. |
| **HIDIVE / Sentai Filmworks** | Anime-focused subscription service and content distributor; has publicised multi-year content and distribution partnerships. | Approach Sentai/HIDIVE for territory-specific distribution or an authorised partner arrangement. No public playback API or VIVID integration permission is assumed by this plan. |
| **Netflix** | Significant anime commissioner and distributor in many markets. | Treat as a licensing/distribution relationship, not a consumer playback endpoint. Require written rights and an approved technical delivery method. |
| **Prime Video Channels / Amazon** | Distribution channel for third-party services, including anime services in selected markets. | Potential commercial distribution route only where Amazon and the underlying rights holder approve VIVID's role. A Prime Video subscription or channel listing does not authorise re-streaming. |
| **Official rights-holder / distributor delivery** | Studios, production committees and regional distributors may license individual titles or packages directly. | Strongest route for a VIVID-owned catalogue. Negotiate title, territory, language, window, monetisation and technical-delivery rights per contract. |
| **Official YouTube channels** | Some rights holders publish selected episodes, trailers or promotional content. | Use official embed/API mechanisms only where the channel owner permits embedding and the content is available in the user's territory. Do not treat this as a substitute for a licensed Premium catalogue. |
| **AniBiz** | B2B anime IP marketplace connecting rights holders with potential licensees. | Useful discovery and introduction channel for rights-holder conversations. It is a licensing marketplace, not a video-streaming API or a source of playable manifests. |

### Primary research references

- Crunchyroll Terms of Service: https://www.crunchyroll.com/en/terms/privacy — the terms include restrictions on incorporating, streaming/retransmitting, and indexing its content without express written authorisation.
- HIDIVE official service: https://welcome.hidive.com/
- AMC Global Media / HIDIVE and MBS distribution partnership announcement (10 August 2026): https://www.amcglobalmedia.com/2026/08/10/amc-global-medias-hidive-and-mainichi-broadcasting-system-extend-partnership-into-next-phase-with-exclusive-output-deal-covering-anime-streamer/
- AniBiz official marketplace: https://anibiz.com/about
- AniBiz licensee information: https://anibiz.com/lp/licensee
- Sony's overview of Crunchyroll's distribution and localisation business: https://www.sony.com/en/SonyInfo/blog/2026/10/06/

These references establish that providers and licensing pathways exist; they do **not** establish that any provider has granted VIVID rights, supplied credentials, or approved a technical integration.

## Ghana and global availability

Provider availability is territory-specific and may vary by title, season, language, subscription tier and release window. Do not infer Ghana availability from a provider's global marketing page or from a title appearing in a catalogue search.

For every licensed title, the rights record must explicitly capture:
- permitted territories (ISO 3166-1 alpha-2 codes);
- start and end of the streaming window;
- permitted business model (SVOD, AVOD, TVOD, promotional/free);
- language and subtitle/dub rights;
- permitted devices, applications and playback domains;
- whether offline playback, downloads, casting or trailers are permitted;
- reporting, attribution and takedown obligations.

If Ghana is not included in the contract, the title must not be playable in Ghana. The catalogue may show a clear regional-unavailability state if the underlying metadata/display rights allow it.

## Provider adapter architecture

Keep a stable VIVID playback contract and implement one server-side adapter per approved partner:

1. **Catalogue adapter** — maps provider title/season/episode IDs to VIVID's canonical TMDB-linked title identity; carries rights metadata and provider availability.
2. **Entitlement adapter** — confirms the user is entitled to the VIVID product and, where required by the partner contract, the partner's own entitlement.
3. **Playback resolver adapter** — exchanges a server-held partner credential and source ID for a short-lived signed HLS/MP4 playback URL, DRM configuration and permitted playback headers.
4. **Playback capability adapter** — reports supported codecs, HLS/DASH, DRM (for example Widevine/FairPlay where contractually supplied), subtitle tracks, audio tracks and quality ladders.
5. **Progress adapter** — accepts playback events only where partner terms permit reporting; VIVID's own progress remains stored server-side.
6. **Rights enforcement** — checks territory, start/end window, language, monetisation and device/application restrictions before issuing a playback session.

Suggested provider interface (server-side only):

```js
{
  id: "partner-id",
  async resolvePlayback({ sourceId, media, user, territory, device }) {
    // Return only contract-approved playback data:
    // { url, expiresAt, mimeType, drm?, subtitles?, audioTracks?, qualities? }
  }
}
```

Never expose partner secrets to the browser. Never store a permanent stream URL as the VIVID source record. The source record should identify the partner's licensed asset; the resolver should mint the short-lived session on demand.

## Current codebase fit

The current Phase 4 API already has:
- `animePremiumSources/{mediaType_titleId_sN_eN}` as a server-managed episode source registry;
- `ANIME_PREMIUM_STREAM_RESOLVER_URL` and `ANIME_PREMIUM_STREAM_RESOLVER_TOKEN` as server-only resolver configuration;
- `ANIME_PREMIUM_STREAM_HOSTS` as a final host allowlist;
- membership and playback-session checks before progress writes.

The generic resolver is the provider-adapter boundary. It should route by a server-validated provider identifier to a partner-specific adapter. It must not accept arbitrary URLs, arbitrary resolver destinations, browser-supplied provider names, or user-supplied stream hosts.

## Phase 4 implementation gates

A provider is **not integrated** until all of the following are true:

- [ ] Written licence / integration authorisation is on file and covers VIVID's intended Premium distribution model.
- [ ] Territory and title/episode rights are recorded and machine-enforced.
- [ ] Provider has supplied an approved API, SDK, feed or delivery mechanism and credentials.
- [ ] Provider adapter resolves a short-lived stream or DRM session without exposing secrets.
- [ ] Host, expiry, MIME type, redirects and manifest/segment delivery are validated.
- [ ] Subtitle, audio, quality and DRM behaviour is tested on supported Android, iOS/Safari and desktop browsers.
- [ ] Playback failures, token expiry, provider outage and revoked rights fail closed.
- [ ] Provider attribution, reporting, privacy and takedown processes are documented.
- [ ] Automated tests cover title/territory/window entitlement and resolver failure.

Until those gates are met, keep the provider visible only as a researched candidate, not as a playable server. Do not populate the production source registry with unofficial mirrors, scraped embed pages, public file hosts or domains whose distribution rights cannot be established.

## Immediate Phase 4 priorities

1. Finish player lifecycle, session expiry, episode navigation and reliable final progress persistence.
2. Formalise the provider adapter/resolver contract and rights metadata.
3. Build a provider due-diligence shortlist and outreach package for Crunchyroll, Sentai/HIDIVE and direct rights holders via AniBiz.
4. Integrate the first partner only after VIVID has written permission, credentials and a test asset.
5. Add real-device playback QA for HLS/DRM, subtitles, audio tracks, network changes and low-bandwidth conditions.

**No third-party provider is represented as partnered with VIVID by this document.**
