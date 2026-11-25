# African Stories — Phase 3 master product and technical blueprint (draft 1)

**Programme:** VividCinema African Stories  
**Phase:** 3 — Master blueprint  
**Status:** Draft for architecture review; no production implementation authorized by this document alone.  
**Research basis:** Phase 2 final research synthesis and the linked evidence register.  
**Scope control:** All Phase 2–7 work remains on PR #524.

## 1. Product definition

African Stories is VividCinema's continental discovery, knowledge and authorized viewing experience for African cinema and moving-image heritage.

It is designed to help audiences:
- discover African films and screen works across regions, languages, eras and formats;
- explore filmmakers, performers, writers, cinematographers, archives, institutions and distributors;
- understand the historical and cultural context of a work;
- find a verified official viewing route where one exists;
- watch inside Vivid only when a title has an approved licence and a tested authorized playback route;
- follow thematic journeys across fiction, documentary, oral history, newsreels, archival footage and historical events.

**Product promise:** discover African stories with trustworthy context and honest access information.

**Not the promise:** every title is streamable, every archive is digitized, or Vivid has rights to everything in the catalogue.

## 2. Product principles

1. **Discovery first, playback by entitlement.** A record can be valuable without an available stream.
2. **Rights before runtime.** No player route is activated until the exact licence and technical authorization are recorded.
3. **Continental by design.** No Ghana-only architecture; regional and diaspora content are first-class.
4. **History with provenance.** Claims, dates, footage, testimony and dramatization must be distinguishable and sourced.
5. **Respect custodians and creators.** Archives, filmmakers, rights holders and communities retain their rights and attribution.
6. **No fake availability.** “Archive record”, “Access pending” and “Watch officially” are meaningful outcomes, not broken-player fallbacks.
7. **Separate concerns.** Catalogue metadata, archive holdings, rights, external access and playback providers are distinct models.
8. **Preserve Vivid.** Existing movie/TV, anime, live playback, downloads, accounts, library, SEO, PWA and platform compatibility remain protected.
9. **Progressive expansion.** Launch a curated, verified cohort and expand based on evidence, rights and operational capacity.
10. **Human editorial accountability.** AI can assist research and matching but cannot approve rights or publish historical facts without review.

## 3. Audience and primary jobs

### Audience groups
- African and diaspora audiences discovering films and histories from their own and other regions.
- Students, teachers and researchers seeking contextualized screen sources.
- Film enthusiasts, festival audiences and cinephiles exploring directors, movements and eras.
- Filmmakers, archivists, distributors and institutions seeking visibility and rights-aware discovery.
- General Vivid users who want African content to be discoverable alongside existing movie and anime experiences.

### Primary jobs
- Find a film by title, alternate title, person, country, language, period, subject or format.
- Browse a country/region or curated collection.
- Understand why a work matters and where its information comes from.
- See whether a work is playable, externally available, archive-only or awaiting access.
- Open a verified official route or start an authorized Vivid playback session.
- Discover related works, people, places, events and historical themes.

## 4. Information architecture

Proposed primary navigation within African Stories:
- **Discover** — featured stories, curated collections, new additions and editorial selections.
- **Films & Series** — fiction, documentary, short, feature, series and animation.
- **History & Archives** — newsreels, oral histories, archival footage, public-information films and digitized records.
- **Countries & Regions** — West, East, North, Central and Southern Africa, plus diaspora and cross-border collections.
- **People** — filmmakers, performers, writers, archivists, producers, historians and other credited roles.
- **Collections** — thematic/editorial journeys with citations and a curator.
- **Timelines** — historically bounded collections and events, with confidence and source notes.
- **About / Contribute** — editorial policy, source standards, corrections, rights-holder submissions and institutional partnerships.

This is a proposed IA, not a requirement to expose every item as a top-level nav link. Phase 5 will test hierarchy and responsive behavior against existing Vivid navigation.

### Page types

1. African Stories landing page.
2. Search results with filters and access-state indicators.
3. Country/region hub.
4. Work/title detail.
5. Person profile.
6. Institution/archive profile.
7. Collection/editorial journey.
8. Historical timeline/event page.
9. External viewing/access route handoff.
10. Dedicated African player page/runtime.
11. Rights-holder submission/contact page.
12. Editorial methodology, provenance and correction pages.

## 5. Catalogue taxonomy

### Work types
- feature film
- short film
- television film
- series / episode
- documentary feature / short
- oral history / testimony
- newsreel
- archival footage / moving-image record
- educational / public-information film
- animation
- experimental / artist moving image
- performance recording
- trailer / promotional work (linked asset, not necessarily a canonical work)

### Subject and context taxonomy
Use a controlled vocabulary with aliases and multilingual labels for:
- historical periods and dated events;
- countries, subnational places and cross-border regions;
- independence and liberation movements;
- political and civic history;
- arts, music, literature and popular culture;
- migration, diaspora and identity;
- language, religion and cultural practice (editorial tags only, not sensitive audience profiling);
- environment, land, climate and livelihoods;
- labour, education, health, science and technology;
- sport and public life;
- conflict, colonialism, resistance and memory;
- film movements, genres and production practices.

Taxonomy must be versioned. Avoid flattening a complex historical work into one country or one genre.

### Geography model
Keep separate:
- country/region of production;
- story location / subject geography;
- nationality or origin of creative participants where supplied and relevant;
- archive custodian location;
- rights territory;
- current viewer territory.

Do not use one country field for all six meanings.

### Language model
Keep separate:
- original spoken language(s);
- title language and original-script title;
- transliterations and alternate spellings;
- dubbed audio languages;
- subtitle languages;
- descriptive/metadata languages;
- accessibility audio/subtitle tracks.

Support multiple languages per work and per edition.

## 6. Canonical domain model

The system must separate these concepts even if the first implementation uses a small number of physical database collections.

### Work
Canonical intellectual work identity:
- stable internal work ID;
- canonical title and original title;
- alternate titles / aliases;
- work type and genre;
- production year/date with precision and confidence;
- runtime only when edition-specific and verified;
- production country/companies;
- synopsis and editorial description with source references;
- people/organizations and their credited roles;
- places, periods, themes and related works.

### Edition / version
A particular cut or manifestation:
- version ID and parent work ID;
- cut/restoration/version label;
- runtime and frame/aspect details where known;
- release/version date;
- audio and subtitle tracks;
- format, carrier and technical characteristics;
- restoration body and source master provenance;
- content edits, censorship or known missing footage;
- edition-specific rights and playback mappings.

### Person / organization
- canonical ID and display names;
- aliases, original-script names and transliterations;
- entity type and verified biography/description;
- roles linked to specific works;
- source references and confidence;
- public contact only when officially published for professional use.

### Institution / archive / distributor
- institution ID and legal/public name;
- type, country and physical/official web address;
- collection scope and known holdings;
- contact route and contact verification date;
- source evidence, access procedures and terms;
- rights authority status (unknown, custodian only, authorized licensor, confirmed for specified works);
- partnership status (prospect, contacted, due diligence, contracted, inactive).

### Source record / provenance
- source ID and source type;
- institution/provider;
- source URL and external record ID;
- title/record as represented by source;
- retrieval date and last checked date;
- source reliability tier;
- permitted metadata reuse / attribution conditions;
- evidence excerpt or curator note;
- link to the canonical work with match confidence and reviewer.

### Holding / archive item
- holding ID and work/version link where known;
- custodian institution and local accession ID;
- physical carrier/format and condition if supplied;
- digitization/restoration status;
- research/consultation conditions;
- reproduction conditions, fees and restrictions;
- embargo and access dates;
- copyright/rightsholder status separately from custody.

### Asset
Posters, stills, trailers, clips, subtitles, captions, artwork and promotional media each require:
- asset ID and linked work/version;
- source and uploader;
- owner/licensor and permission evidence;
- allowed uses, territory, term and attribution;
- file/remote reference, dimensions and format;
- moderation and expiry status.

### Access route
- route ID and work/version;
- route type: official external watch, archive consultation, public screening, partner preview, licensed embed, Vivid stream;
- destination/provider and official source evidence;
- territory and date constraints;
- login/payment/access conditions;
- embed permission and domain constraints;
- last verification, verifier and outcome;
- fallback and user-facing instructions.

### Rights grant
- grant ID, licensor and authority evidence;
- work/version and included elements;
- rights granted and expressly excluded;
- territory allowlist/blocklist;
- start/end dates, windows and holdbacks;
- platform/domain/device scope;
- monetization and price model;
- language/subtitle rights;
- DRM/geo/concurrency requirements;
- fees, revenue share and reporting;
- warranties, indemnity, audit and takedown;
- contract reference, legal review and renewal status.

### Playback provider
- provider ID and approved legal/service identity;
- provider type and integration method;
- contract/rights references;
- provider-side work/version ID;
- allowed domains and territory controls;
- authentication/signed URL requirements;
- API/SDK version and credential reference (secret stored server-side);
- health-check configuration and SLA;
- incident/expiry/takedown state.

### Editorial record
- editorial ID, author/editor/reviewer;
- factual claims and supporting sources;
- historical date confidence and disputed interpretations;
- testimony vs documentary interpretation vs dramatization labels;
- sensitivity/content notes;
- correction history and review date.

## 7. Rights and access state machine

### Public-facing states
- **Discover / archive record** — a work or holding is documented; no current public viewing route is confirmed.
- **Access pending** — access or rights are being investigated; no promise of availability.
- **Watch officially** — a verified official external destination is available. Vivid is not representing the stream as its own.
- **Play on Vivid** — the named territory, term, monetization and delivery mode are licensed and playback has passed QA.
- **Unavailable / expired** — route withdrawn, expired, blocked, under review or not currently usable.

### Internal states
- research_only
- archive_record
- access_pending
- official_route_verified
- rights_review
- rights_approved_embed
- rights_approved_vivid_stream
- technical_qa
- active_embed
- active_vivid_stream
- expired
- suspended
- rejected

### Transition rules
- Discovery record can be published only with source provenance and editorial review.
- An official route requires verification of the publisher/rights source, target URL, territory and last-checked date.
- Licensed embed requires written rights that expressly permit embedding on the relevant Vivid domain and the provider's embed policy must allow it.
- Vivid stream requires written rights for hosting/delivery and communication to the public/VOD in each territory, plus technical and security approval.
- Expired, withdrawn, disputed or suspended grants immediately disable playback, invalidate sessions where feasible and preserve an audit record.
- No state is upgraded based only on a URL, public access, archive custody, a platform's catalogue listing or an AI match.

## 8. Third player architecture

### Boundary

The African player is a distinct third playback system. Existing movie/TV and anime players remain separate and unchanged unless a reviewed shared infrastructure fix is required.

### Logical components
1. **African title resolver:** maps requested work/version IDs to approved access routes; resolves aliases and external identifiers with confidence.
2. **Entitlement service:** evaluates rights grant, territory, time window, platform, monetization and user/session eligibility.
3. **Provider registry:** stores approved provider adapters and their integration/contract constraints.
4. **Playback session broker:** creates short-lived authorized sessions, signed requests or embed configurations after entitlement passes.
5. **African player runtime:** handles authorized iframe/SDK/HLS/DASH playback, controls, subtitles, resume, errors and accessibility.
6. **Source health monitor:** checks approved route health and reports outages/expiry without scraping hidden endpoints.
7. **Audit/telemetry:** records entitlement decision, provider, territory, version, playback start/error/completion and rights evidence reference without logging secrets or unnecessary personal data.
8. **Fallback resolver:** sends user to official external viewing, archive record, access-pending or unavailable state when no playable source is authorized.

### Provider adapter contract
Each adapter must declare:
- provider identity and approved integration type;
- permitted use and signed agreement reference;
- supported territories and window rules;
- title/version identity mapping;
- embed domain policy or server-to-server API contract;
- authentication/token/signature requirements;
- supported formats/codecs/captions/audio;
- DRM requirements where applicable;
- error mapping, health checks and rate limits;
- shutdown/takedown behavior.

Do not create a generic “try these URLs” provider loop. No hidden URL extraction, unauthorized scraping, DRM bypass, geo-block circumvention, paywall bypass or origin-header spoofing.

### Fail-closed behavior
If entitlement is absent, ambiguous, expired or unavailable, no playback session is issued. Show the correct access state and, if present, a separately verified official route. Do not silently fall back to an unlicensed source.

## 9. Data ingestion and metadata operations

### Source priority
1. Rights holder / producer / archive / official institution record.
2. Official distributor / sales-agent / broadcaster catalogue.
3. Festival programme and filmmaker-submitted metadata.
4. Trusted film databases and institutional research guides.
5. Community-submitted leads (unverified until reviewed).

### Ingestion workflow
1. Discover a candidate record.
2. Store raw source metadata and provenance.
3. Normalize title, aliases, dates, language, country and people.
4. Match against canonical work records using external IDs plus human review.
5. Detect duplicates and title/version collisions.
6. Review asset reuse permissions.
7. Editorial fact-check and context.
8. Determine public catalogue state.
9. Create separate access-route and rights records.
10. Re-verify volatile external routes on a schedule and when user reports fail.

### Matching rules
- Never merge works on title similarity alone.
- Use title + director/creator + year + country + runtime/edition where available.
- Preserve original-script titles and transliteration variants.
- Keep remakes, alternate cuts, restorations, series episodes and works with reused titles separate.
- Record match confidence, evidence and reviewer.

### Data licensing
Before ingesting external metadata or images at scale, confirm API/terms, attribution, caching, commercial-use rules and derivative database restrictions. TMDB and Wikidata may support discovery/identity but do not supply playback rights. Do not scrape protected catalogues.

## 10. Editorial and historical integrity

Each public work record should include:
- who created it and the evidence for credits;
- what kind of work it is;
- production date and the confidence/precision of that date;
- geographic distinctions (production, story, archive custody);
- the historical period or events it addresses;
- sources for editorial claims;
- whether it is documentary, testimony, archive record, dramatization or fiction;
- known restoration/version differences;
- content notes where appropriate;
- correction/contact path.

### Editorial review requirements
- No unsupported historical assertions.
- Attribute disputed or contested claims.
- Distinguish first-person testimony from independently corroborated fact.
- Avoid treating colonial administrative descriptions as neutral or complete.
- Add context for archival footage that depicts racist, violent, exploitative or traumatic material.
- Respect privacy, cultural protocols, dignity and lawful restrictions.
- Provide a correction and takedown request process.
- AI-generated summaries/translations/tags require human review before publication.

## 11. Search, browse and ranking

Search must support:
- title and alternate title;
- original-script title and transliteration;
- person and credited role;
- country/region and place;
- language;
- work type and genre;
- period/year range;
- theme/subject;
- archive/institution;
- access state.

Ranking should prioritize exact title/person matches, verified source quality, editorial curation, relevance and available filters. Do not rank a streamable title above a historically important archive record solely because it plays. Make access status filterable and visible.

Avoid sensitive profiling or inferring a user's ethnicity, religion or politics from viewing behavior. Personalization can use explicit user preferences and normal watch history under existing privacy controls.

## 12. UX and visual system

The design should feel like a premium cinema and cultural-knowledge product, not a generic streaming clone or a community feed.

### Core title card
- artwork only when usage rights are established;
- canonical title and year;
- country/region and work type;
- language indicators where helpful;
- concise access state;
- no fake play icon on archive-only records.

### Work detail hierarchy
1. Title, original title, year and work type.
2. Access action/state.
3. Synopsis and key credits.
4. Country/region, languages, runtime/version.
5. Historical/editorial context with citations.
6. Related people, works, collections and timeline.
7. Archive/holding/provenance details where public.
8. Rights/access notes and correction link.

### Accessibility
- keyboard and screen-reader support;
- visible focus and adequate contrast;
- captions/subtitles and accessible player controls;
- reduced-motion support;
- language labels rather than flag-only indicators;
- responsive layouts for mobile, tablet, desktop and Android webview;
- accessible unavailable/error states.

## 13. Integration and preservation constraints

Must preserve:
- existing movie/TV watch routes and provider logic;
- existing anime identity and playback logic;
- live playback;
- downloads and offline behavior;
- Firebase authentication and Firestore user records;
- personal library and user settings;
- SEO metadata and existing public routes;
- service worker/PWA caching behavior;
- Android/Desktop/Web compatibility;
- newsroom reading and sharing.

Implementation must use additive, namespaced African Stories modules and routes. Avoid modifying shared player code unless a narrow, reviewed abstraction is demonstrably required and regression tests cover every existing player. Do not delete dormant community backend data or unrelated files as part of this work.

## 14. Security, privacy and operations

- Keep provider API keys, signing secrets and contract credentials server-side.
- Use least-privilege service accounts and scoped provider tokens.
- Validate provider hostnames and embed origins against allowlists.
- Protect playback session endpoints against IDOR and entitlement bypass.
- Apply rate limits and abuse controls to title resolution and playback session creation.
- Sanitize external metadata and URLs; treat provider responses as untrusted.
- Avoid exposing private contract/rights data in client bundles or public catalogue responses.
- Store only necessary playback telemetry; follow existing privacy/retention policy.
- Provide administrative audit trails for rights approval, state transitions, takedown and expiry.
- Add alerting for expired licences, provider outages, geo/entitlement mismatch and repeated failures.
- Document incident response and emergency playback disablement.

## 15. Rollout strategy

### Internal milestones
1. Architecture and data model review.
2. Rights/access state model review with legal/product stakeholders.
3. Provider adapter contract and security review.
4. Curated metadata cohort and editorial workflow.
5. Non-production player integration using only approved test assets.
6. Accessibility and device regression.
7. Closed beta with a small, rights-cleared title cohort.
8. Staged public launch by territory and verified content cohort.
9. Expand only when ingestion, rights review, provider operations and support can sustain it.

### Launch gates
- every playable title has a signed rights record and exact territory/window;
- every asset has independent reuse permission;
- all provider routes pass authorization and playback QA;
- geo/term expiry behavior is tested;
- no unauthorized stream discovery or fallback exists;
- editorial provenance and correction links are present;
- existing Vivid player/download/account flows pass regression;
- accessibility, security, performance and mobile/device tests pass;
- support and takedown processes are staffed.

## 16. Phase 3 decisions requiring explicit review

These are architecture decisions, not assumptions to silently implement:
1. Where African Stories appears in global Vivid navigation and whether it receives a dedicated top-level destination.
2. Whether first release is discovery-only plus a small licensed playback cohort, or discovery-only until Phase 6 contracts are ready. Recommendation: discovery catalogue and official external routes can launch before in-Vivid playback; licensed playback is enabled only for individually cleared titles.
3. Which backend environment and data store own the canonical catalogue and rights records, taking account of current Firebase/Firestore architecture and security rules.
4. Whether editorial publishing is integrated with an existing admin/CMS workflow or a new scoped admin surface.
5. The initial country/region launch cohort and minimum language coverage.
6. Which metadata sources permit commercial reuse and which are link-only discovery sources.
7. Which provider integration types are acceptable for the first authorized African player release.
8. What content-rating, age-gating and sensitive-history review policy is required in each launch market.
9. Which user library features (save, watchlist, progress) should support African Stories in the first release without changing existing user data semantics.
10. What operational owner reviews licence expiry, source health, corrections and takedowns.

## 17. Phase 3 acceptance criteria

Phase 3 is complete only when:
- product scope, audiences and non-goals are approved;
- IA, page types and navigation are documented;
- canonical data model and taxonomy are documented;
- provenance and editorial standards are documented;
- rights/access state machine is approved;
- third-player architecture and adapter contract are documented;
- security, privacy, observability and failure behavior are specified;
- metadata ingestion and review workflow is documented;
- compatibility/regression boundaries are explicit;
- launch gates, operational ownership and deferred partner/legal tasks are assigned;
- unresolved decisions are recorded with an owner and a decision date.

**No production code should be treated as Phase 4 implementation until this blueprint has passed review.**
