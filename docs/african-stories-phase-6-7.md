# African Stories — Phases 6 and 7

## Combined delivery objective

Phases 6 (content acquisition and partnerships) and 7 (launch, measurement and expansion) form one operational layer. Discovery remains useful before licensing exists. Vivid playback, paid promotion and claims of partnership stay disabled until evidence is recorded and reviewed.

## Phase 6 — acquisition and rights-holder operations

### Acquisition funnel

1. Discover prospects: filmmakers, producers, estates, archives, film schools, national film institutes, festivals, distributors, sales agents and community screening organisations.
2. Receive minimal metadata: title, country, format, year, languages, submitter role/contact, public project link and rights-authority declaration. No screeners or sensitive documents through the public form.
3. Triage: verify identity/authority, completeness, provenance, production/premiere history, existing agreements and control of offered rights.
4. Rights assessment: document edition, territory, language, channel, exclusivity, term, window, sublicensing, promotional use, music, archive footage, performer releases and collective-management obligations.
5. Editorial assessment: cultural context, historical claims, local-language metadata, captions/subtitles, accessibility, audience relevance and source reliability.
6. Commercial negotiation: fees or revenue share, reporting, payment schedule, taxes, currency, deductions, audit rights, marketing approvals, takedown and dispute process.
7. Contract and delivery: no ingest or playback before signed authority, rights evidence, delivery QC and provider authorization.

### Partner prospect pipeline

The data/african-stories-partners.json file is a research shortlist, not a list of signed or approved partners. Prospects include MIFF/MPPLUS, PAFFnow, Laba Cinema, FilmMerge/AfriSpotlight and AfroPix. Re-verify every lead before outreach. Public descriptions do not establish a commercial relationship with Vivid.

A six-market study commissioned by GIZ and Afreximbank, based on 1,630 audience responses and 91 stakeholder interviews across Egypt, Kenya, Nigeria, Rwanda, Senegal and South Africa, identifies distribution and monetisation as a bottleneck and recommends stronger African-owned aggregators, distribution funding and regional licensing. Build a multi-route pipeline rather than depend on one global streamer. Source: https://dalberg.com/announcements/new-six-country-study-finds-strong-demand-for-african-stories/

### Submission service boundary

The public intake form posts metadata to /api/african-stories/submissions. The Pages Function validates payload shape, same-origin requests and affirmative rights/privacy declarations, then forwards to optional AFRICAN_STORIES_INTAKE. Without that binding it returns 503 and stores nothing. The upstream must implement encrypted durable storage, access control, spam protection, audit logs, retention/deletion, notification and a human review queue. An acknowledgement is not acceptance or a contract.

### Non-negotiable rights model

- Verify rights per title and edition; never infer them from a festival selection, archive record, trailer, embed or aggregator listing.
- Separate discovery, official external viewing and Vivid-licensed playback.
- Record grantor authority, evidence, territory, channel, language, term, exclusivity, window, expiry, takedown contact and review timestamp.
- Reject unclear chain of title, conflicting grants, expired rights, missing music/archive clearances and territory mismatches.
- Do not scrape, rip, rehost or play a source merely because it is publicly accessible.
- Prefer narrow, time-limited rights where commercially and legally appropriate; the signed agreement controls.
- Provide rights complaint and takedown process before public playback.

## Phase 7 — staged launch and measurement

### Launch stages

**Stage 0 — internal QA:** test country hubs, editorial records, rights-state display, keyboard/screen-reader access, mobile layouts, low-bandwidth behavior, privacy, errors and rollback.

**Stage 1 — discovery preview:** publish the atlas and verified official external links. Keep Vivid playback locked. Invite filmmakers, archivists and local reviewers to challenge metadata and context.

**Stage 2 — licensed pilot:** enable a small, diverse slate only after signed title-level grants, provider contracts, subtitle/caption QC, territory tests, takedown process and monitoring are complete.

**Stage 3 — measured expansion:** expand country/language coverage based on rights-holder participation, audience demand, playback reliability, local editorial review and sustainable economics—not raw title count.

### Consent-aware measurement

The metrics endpoint accepts a strict event allowlist and low-cardinality dimensions only. It requires an explicit analytics-consent header and AFRICAN_STORIES_ANALYTICS binding. It rejects names, email, account identifiers, free-text searches, precise location, IP addresses and playback URLs. If the binding is absent, metrics are not recorded.

Track discovery-to-title-open rate, source-link engagement, search-to-result rate, country/region coverage, submission completion, playback error rate, caption/subtitle coverage and low-bandwidth success. Segment only by coarse country, region, format and access state. Configure retention/access controls in the analytics account before launch.

### Release gates

The data/african-stories-launch-gates.json file is the release checklist. All required gates need reviewable evidence. Initial state is deliberately not_ready; playback, paid promotion and partner claims are disabled. A green code deployment is not proof of rights, privacy, accessibility or commercial readiness.

## Configuration required before launch

- AFRICAN_STORIES_INTAKE: secure intake processor service binding.
- AFRICAN_STORIES_ANALYTICS: Cloudflare Analytics Engine dataset binding.
- AFRICAN_STORIES_PROVIDER: authorized provider-session adapter.
- Signed provider and title-level rights agreements, reviewed by an authorized rights/legal owner.
- Privacy/retention policy, consent integration, support/takedown workflow, captions/subtitles and device/territory QA.

## References

- Dalberg / GIZ / Afreximbank, Made in Africa, Watched Globally? (11 November 2026): https://dalberg.com/announcements/new-six-country-study-finds-strong-demand-for-african-stories/
- MIFF / MPPLUS: https://www.miff.co.za/mpplus/
- Laba Cinema distribution partner pack: https://www.labacinema.com/filmdistribution/pack
- PAFFnow: https://www.paffnow.com/home
- FilmMerge / AfriSpotlight: https://www.filmmerge.com/
- AfroPix: https://afropix.com/pages/our-mission
