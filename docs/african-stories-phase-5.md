# African Stories Phase 5 — discovery atlas and researched editorial layer

## Experience foundation

The destination is a screen library and story atlas, not a social feed or a generic movie rail.

- Five regional entry points and 54 country hubs.
- Search, region, format and language filtering.
- Dedicated collections, people, timelines and documentary journeys.
- Editorial detail routes with connected people and historical milestones.
- Explicit access labels: Stream on Vivid, Watch officially, Discover / archive record and Access pending.
- No catalogue entry is treated as a streaming licence.

## Researched editorial starter set

The current starter set contains six collections, nine people/profiles, fourteen timeline milestones and six documentary journeys. It deliberately begins with deeper coverage of Ghana, Nigeria, Senegal, Mali, Mauritania, Egypt, Kenya, Angola, Eswatini and South Africa rather than pretending every country has equally researched coverage.

The editorial layer prioritises questions that are often flattened in popular summaries:

- Colonial cinema in the Gold Coast as both exhibition culture and an instrument of administration, censorship and imperial messaging.
- The Gold Coast Film Unit's 1947/1948 dating discrepancy, preserved as an unresolved source difference.
- The 1918 licensing reference in archival scholarship alongside the Ghana ministry's 1923 public-history milestone.
- The transition from colonial film infrastructure to Nkrumah-era GFIC, including both Pan-African ambition and the power of state-authored memory.
- The 1980/1981 date discrepancy for Love Brewed in the African Pot.
- Nollywood as a multi-lineage movement shaped by Yoruba travelling theatre, television, video technology, marketers and informal distribution—not a one-film invention.
- FESPACO as a major Pan-African institution that has also faced debates about format, taste, inclusion and its role in defining African cinema.
- Restoration versus restitution: preservation, custody, access, rights and interpretive authority are treated as separate questions.
- Women filmmakers, regional differences and transnational careers are treated as central histories rather than sidebars.

## Editorial integrity rules

Every published editorial record must include a stable ID, summary, `published: true`, an evidence key and one or more HTTPS references. The detail view distinguishes:

1. **The familiar version** — the received shorthand or common narrative being examined.
2. **Why this matters** — the historical or cultural significance.
3. **Evidence note** — what the sources support, where interpretation begins and what remains unresolved.

The interface must not present a contested interpretation as settled fact. Where sources disagree, preserve the disagreement and explain what kind of evidence could resolve it. Use confidence notes and source limitations; do not invent archival holdings, quotations, dates, film credits, language claims, rights or streaming availability.

Every film/title record belongs in the versioned catalogue and must carry a stable title and edition ID, country code, supported format, language list, synopsis, provenance evidence reference and HTTPS source URL, approved editorial review timestamp, and explicit access state. Only reviewed records appear in discovery.

## Research priorities for the next editorial pass

- Add primary archival records and local-language scholarship, especially for Ghana, Nigeria and the Sahel.
- Verify film dates against production files, premiere programmes, contemporary newspapers and oral histories where possible.
- Add regional-language metadata and community context with local editorial review.
- Expand beyond the initial country cluster without treating English- or French-language web visibility as a proxy for historical importance.
- Add accessibility and language filters after the underlying metadata is verified.

## QA

Run `npm test` and the repository syntax checker. Verify detail routes, keyboard navigation, screen-reader labels, narrow mobile layouts and external-reference handling before enabling the destination broadly.
