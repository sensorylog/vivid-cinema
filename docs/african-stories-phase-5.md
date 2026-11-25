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

The current starter set contains eighteen collections, fifteen people/profiles, thirty-one timeline milestones, eight documentary journeys and six reviewed discovery-only title records. It deliberately begins with deeper coverage of Ghana, Nigeria, Senegal, Mali, Mauritania, Egypt, Kenya, Angola, Eswatini and South Africa rather than pretending every country has equally researched coverage.

The editorial layer prioritises questions that are often flattened in popular summaries:

- Colonial cinema in the Gold Coast as both exhibition culture and an instrument of administration, censorship and imperial messaging.
- The Gold Coast Film Unit's 1947/1948/1949 dating discrepancy, preserved as an unresolved source difference.
- The distinction between 1912 fire-safety regulation and formal 1925 censorship; early travelling screenings and a 1914 Accra theatre; and the Ghana ministry's 1923 public-history marker.
- The transition from colonial film infrastructure to Nkrumah-era GFIC, including both Pan-African ambition and the power of state-authored memory.
- The 1980/1981 dating variation for Love Brewed in the African Pot, with 1980 treated as the better-supported film date and 1981 explicitly qualified.
- Nollywood as a multi-lineage movement shaped by Yoruba travelling theatre, television, video technology, marketers and informal distribution—not a one-film invention.
- FESPACO as a major Pan-African institution that has also faced debates about format, taste, inclusion and its role in defining African cinema.
- Restoration versus restitution: preservation, custody, access, rights and interpretive authority are treated as separate questions.
- Ghanaian moviegoers are treated as active participants in exhibition culture and distribution economics, not passive colonial audiences.
- A 2011 Ghana cinema dissertation documents the reported loss and displacement of film-library materials, the collapse of practical projection access, and the need to distinguish surviving reels from usable public heritage.
- The same research records GFIC’s commercial-financing problems, the reported use of a house and cocoa farm as collateral for Love Brewed in the African Pot, and the studio’s rejection of an early video-film screening.
- French colonial restrictions on who could film, and the 1960 repeal of the Laval Decree, are connected to filmmaker histories.
- Egypt’s industrial cinema history is paired with the domestic ban on Chahine’s Cairo Station.
- FESPACO’s contested relationship with Nollywood and video formats is treated as a debate over the canon, not just a technical footnote.
- Women filmmakers, regional differences and transnational careers are treated as central histories rather than sidebars.

## Expanded research layer (November 2026)

The current editorial set adds five connected research strands:

- **Women and archival silences:** Annette Mbaye d’Erneville as a critic and institution-builder; Safi Faye and Thérèse Sita-Bella as filmmakers whose works are difficult to locate; and Sarah Maldoror’s work within the anti-colonial screen history. The interface does not imply that a film is currently available just because scholarship names it.
- **Nollywood’s multiple beginnings:** a 2024 thesis maps disputed early-video claims, including Yoruba travelling-theatre lineages and experiments in Onitsha, Enugu and Port Harcourt. Living in Bondage remains an important commercial landmark, not a definitive answer to every "first" question.
- **Nollywood’s audience economy:** household-to-household VHS sharing and communal viewing are connected to the later shift toward smartphone streaming and more individualised viewing.
- **Clandestine anti-apartheid documentary:** Morena Films, Nana Mahomo, Phela-Ndaba / End of the Dialogue (1970), Last Grave at Dimbaza (1974), international circulation and the official counter-film response.
- **Archive scale versus practical access:** the Mayibuye Archive reports acquiring approximately 5,000 Beta recordings in 2000 and explicitly says its online inventories remain a work in progress.
- **Ghanaian audiovisual preservation:** Rebecca Ohene-Asah’s peer-reviewed research connects storage and preservation practices to the public’s ability to access historical film materials.

Country metadata now connects collections, people, milestones and journeys to country hubs. Search covers editorial titles, summaries, themes and evidence framing; country selection filters the editorial sections as well as the title catalogue.

The six title records are **Sambizanga**, **Yeelen**, **Cairo Station**, **Last Grave at Dimbaza**, **Living in Bondage** and **Kaddu Beykat**. Each is published as `discover_archive_record` with provenance and an editorial review timestamp. None is presented as a Vivid stream or as an authorized playback source. Title pages explain the access limitation rather than pretending that a catalogue entry grants viewing rights.

## Phase 5 completion boundary

Phase 5 is the knowledge and discovery experience. It includes country hubs, researched collections, sourced people profiles, historical timelines, documentary journeys, cross-links, search and filters, source notes and access-state honesty.

It does **not** claim that Vivid has acquired content, signed rights agreements, activated provider playback or completed launch operations. Those are later-phase work. An empty title catalogue is preferable to invented titles, fake availability or unlicensed playback.

## Editorial integrity rules

Every published editorial record must include a stable ID, summary, `published: true`, an evidence key and one or more HTTPS references. The detail view distinguishes:

1. **What the evidence complicates** — the received shorthand or common narrative being examined.
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
