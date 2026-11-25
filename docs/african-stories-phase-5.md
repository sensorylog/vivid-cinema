# African Stories Phase 5 — discovery atlas

## Experience foundation

The destination is a screen library and story atlas, not a social feed or a generic movie rail. The first implementation provides:

- Five regional entry points: North, West, Central, East and Southern Africa.
- A country index for 54 African countries with region membership.
- Search and region filtering for country hubs.
- Format, language and text filtering for published title records.
- Dedicated editorial sections for collections, filmmakers and cultural people, historical timelines and documentary journeys.
- A country-hub route state using `?country=ISO-3166-1-alpha-2`.
- Explicit access labels: Stream on Vivid, Watch officially, Discover / archive record and Access pending.
- Evidence-gated editorial records. Collection, people, timeline and journey cards are rendered only when published and supplied with an evidence reference.

## Editorial content contract

The experience data file contains regional and country navigation only. Its collections, people, timelines and journeys arrays start empty. Do not fill these sections with invented biographies, historical dates, archive holdings, title availability or rights claims. Every editorial record must have a stable ID, title, summary, `published: true` and `evidenceRef`. Every film/title record belongs in the versioned catalogue and must carry a stable title and edition ID, country code, supported format, language list, synopsis, provenance evidence reference and HTTPS source URL, an approved editorial review timestamp, and an explicit access state. Only those reviewed records appear in discovery.

## Next implementation steps

- Add sourced collection records and their title relationships.
- Add filmmaker and historical-person profiles with verified identity, biography citations and filmography links.
- Add historical timeline entries with dated primary/secondary references and uncertainty labels where appropriate.
- Add documentary journeys that connect records across countries without implying a title is playable.
- Add localized language and accessibility filters.
- Complete browser, mobile and device QA before enabling the destination in the primary navigation for all users.
