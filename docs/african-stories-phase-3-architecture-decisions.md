# African Stories — Phase 3 architecture decisions

**Status:** recommended baseline locked for Phase 4 planning; product/legal launch gates remain explicit  
**Parent:** [Phase 3 master blueprint](african-stories-phase-3-master-blueprint.md)  
**Codebase evidence:** [Phase 3 codebase architecture audit](african-stories-phase-3-codebase-architecture-audit.md)

This record resolves the architecture choices that can be settled from product direction, Phase 2 research and the current VividCinema repository. It does not claim user/legal approval of commercial terms, partner rights or launch markets.

## ADR-01 — Product identity and global navigation

**Decision:** African Stories receives a dedicated top-level destination in Vivid navigation, with its own discovery landing, country/region hubs and work detail pages.

**Reason:** this is a distinct cinema and heritage experience, not a filter on the general TMDB catalogue. It must be discoverable without changing the existing movie/TV and anime navigation semantics.

**Implementation:** additive route entries in `scripts/config.js` and `scripts/routes.js`; dedicated HTML pages and namespaced modules. Keep the current home, discover, anime, library and watch routes intact.

## ADR-02 — Release sequence

**Decision:** launch the catalogue/discovery layer first, with verified official external routes where available. Enable Vivid playback only title-by-title after rights and technical gates pass.

**Reason:** archive catalogues, festival programmes and external links are not streaming licences. This sequence provides real discovery value without inventing a playable catalogue.

**Implementation:** public access states distinguish archive record, access pending, watch officially, Play on Vivid and unavailable/expired. No default player action for archive-only records.

## ADR-03 — Canonical data store

**Decision:** use the existing Firebase project and Firestore as the first canonical catalogue store. Use Cloud Functions (Node.js 22, Admin SDK) for privileged mutations and publication.

**Reason:** this matches the actual deployed application stack, existing authentication, test tooling and operations. A second database or platform migration is not justified by the Phase 2 evidence.

**Implementation:** namespaced African Stories collections, explicit indexes, emulator-backed rules tests and additive Functions exports. Reassess only if measured scale, search requirements or editorial workflow outgrow Firestore.

## ADR-04 — Public/private data separation

**Decision:** publish public-safe catalogue projections into separate public collections. Keep drafts, rights grants, contracts, private provider configuration, legal review and audit events in server-only collections.

**Reason:** Firestore rules authorize documents, not individual fields. A single mixed document cannot safely expose catalogue metadata while hiding contract fields.

**Implementation:** public collections such as `africanWorksPublic`, `africanPeoplePublic`, `africanInstitutionsPublic`, `africanCollectionsPublic` and `africanTimelinesPublic`; private namespaces such as `africanWorkDrafts`, `africanRightsGrants`, `africanProviderRegistryPrivate`, `africanEditorialQueue` and `africanAuditEvents`. Public clients have read-only access; private namespaces deny all client access.

## ADR-05 — Editorial/admin surface

**Decision:** create a dedicated African Stories admin surface. Do not extend `moderator.html` or `scripts/editorial-desk.js` into a film archive/rights CMS.

**Reason:** the existing desk is designed for newsroom sources, story publication and moderation. African Stories requires work/version matching, archive holdings, source provenance, asset permissions, rights review, provider approval and audit history.

**Implementation:** a new scoped admin page and `scripts/african-stories/admin/` modules. Reuse visual and authentication patterns, not newsroom data semantics.

## ADR-06 — Privilege model

**Decision:** use separate least-privilege custom claims for African Stories editor, publisher, rights administrator and provider administrator. The existing `moderator` claim is insufficient.

**Reason:** a newsroom moderator should not gain access to contracts, provider credentials or playback entitlements by virtue of moderating news.

**Implementation:** claims `africanStoriesEditor`, `africanStoriesPublisher`, `africanStoriesRightsAdmin` and `africanStoriesProviderAdmin`. Enforce all privileged actions in Cloud Functions. No self-service role assignment.

## ADR-07 — Third player isolation

**Decision:** implement African Stories as a separate third player with its own title/version resolver, entitlement service, provider registry, session broker, player runtime, telemetry and fallback state resolver.

**Reason:** existing movie/TV, TFLIX and anime players have separate identities and provider assumptions. African playback has different rights, version, archive and territory constraints.

**Implementation:** dedicated `african-stories-watch.html` route and `scripts/african-stories/player/` namespace. Reuse low-level playback primitives only after review. Do not add African sources to existing provider registries.

## ADR-08 — Provider and access policy

**Decision:** no generic provider-URL loop, stream scraping, hidden endpoint extraction, guessed URL construction, origin spoofing, DRM/paywall/geo bypass or silent fallback.

**Reason:** playback must be traceable to an authorized title/version, provider, territory, term and delivery grant.

**Implementation:** the server issues a short-lived playback session only after entitlement succeeds. Missing, ambiguous, expired, suspended or mismatched rights fail closed. Verified official external routes are displayed as external routes, not Vivid playback.

## ADR-09 — Search and discovery

**Decision:** begin with Firestore-backed curated discovery and indexed filters. Do not introduce a third-party search engine before the catalogue size and query latency justify it.

**Reason:** the initial launch is expected to be curated and provenance-heavy. External search services introduce cost, data processing and metadata licensing questions before demand is proven.

**Implementation:** support title/alias, person, country/region, language, work type, period, theme, institution and access-state filters. Keep ranking transparent and avoid ranking only by playability.

## ADR-10 — User library compatibility

**Decision:** do not change the existing movie/TV favorites, watchLater, history or progress document schemas for African Stories in Phase 4. Add a separate namespaced saved-work capability only when its user value and data rules are specified.

**Reason:** existing library rules validate numeric TMDB IDs and movie/TV media types. Reusing those schemas would create ID collisions and risk existing account data.

**Implementation:** if save/bookmark is included, use a separate user subcollection keyed by canonical African work ID, with independent Firestore rules and tests. Playback progress is not enabled until a licensed Vivid playback route exists.

## ADR-11 — Country and language rollout

**Decision:** make the information architecture continental from day one, but launch content coverage progressively based on verified records and partner capacity. Do not announce a fixed first-wave country list until source verification and editorial capacity are measured.

**Reason:** Phase 2 identifies uneven archive infrastructure and evidence quality. A country list based on political geography alone would overpromise actual catalogue depth.

**Implementation:** all country/region hubs can exist as discoverable taxonomy destinations; show honest empty/limited states. Initial editorial cohort selected from verified title/source coverage, language metadata and local review capacity before public launch.

## ADR-12 — Language policy

**Decision:** support multilingual metadata at the data-model level from the beginning; ship English UI first only as an initial interface baseline, not as an assumption that African works are English-language.

**Reason:** works may have multiple original spoken languages, scripts, transliterations, dubbed audio and subtitles. Language cannot be collapsed into a single country flag or UI language.

**Implementation:** separate original audio, subtitles, dubbing, title script/transliteration and metadata language fields. Add localized UI strings as capacity permits; do not imply subtitles exist unless an edition-specific track is verified.

## ADR-13 — Content sensitivity and editorial policy

**Decision:** use a human-reviewed content-note and historical-context workflow. Do not auto-age-rate or auto-classify sensitive history from AI output.

**Reason:** colonialism, conflict, racism, political violence, religion, identity and testimony require context, care and market-specific legal review.

**Implementation:** content notes and review labels are editorial records with source evidence. Age-rating requirements and formal classification remain a territory-specific launch gate requiring local legal review.

## ADR-14 — Metadata and asset reuse

**Decision:** maintain source-level metadata reuse terms and asset-level permissions. Link to discovery resources where reuse rights are unclear; do not bulk-copy records or images based on public visibility.

**Reason:** source catalogues and archive records may be searchable while commercial reuse is restricted. Image rights are not implied by film rights.

**Implementation:** record source terms, attribution, retrieval/check dates and allowed use; each poster, still, trailer, clip and subtitle has its own permission record and expiry.

## ADR-15 — Operational ownership

**Decision:** require named operational owners before enabling licensed playback: catalogue/editorial owner, rights approver, provider operator and incident/takedown contact.

**Reason:** a technically working stream can still be unlawful or remain live after a licence expires. Rights expiry and emergency takedown must be actionable.

**Implementation:** server-side audit log, expiry alerts, kill switch per title/provider, periodic route checks and a documented escalation process. No production playback until owners and response SLAs are assigned.

## Remaining launch gates (not Phase 3 architecture blockers)

These cannot be responsibly fixed from code inspection alone:
- local counsel's interpretation and market-specific classification obligations;
- exact first-wave country list and minimum local editorial coverage;
- written rights and chain-of-title for each title/version;
- metadata and artwork commercial reuse permissions;
- signed provider agreements and permitted embed/API behavior;
- named operational owners, support coverage and takedown SLA;
- exact monetization model for licensed titles.

## Phase 3 exit assessment

The architecture baseline is now sufficiently concrete to begin Phase 4 engineering behind strict feature and entitlement gates. Phase 4 must still implement and test the schema, Firestore rules, privileged Functions, admin workflow and isolated player; this decision record does not imply those systems already exist.

Phase 3 is considered complete for architecture planning when this decision record and the codebase audit are reviewed alongside the master blueprint. Product/legal launch gates above remain open and must not be represented as approved.
