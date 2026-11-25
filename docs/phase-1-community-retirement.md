# Phase 1 — Community product retirement

## Retired from active product
- Culture Room / Community feed, posts, polls, follows and social highlights
- News article discussions and comments
- Watch Rooms, shared screening and Cinema Clubs

## Kept active
- Newsroom editorial feed and sourced story pages
- Sharing of newsroom stories
- Existing authentication, personal library, playback, downloads, live, anime, PWA and platform shell

## Data safety
This is an interface/product retirement, not a destructive data migration. Existing Firestore community posts, polls, follows, reports, room/club records, nested members, queues and historical content are retained. Firestore rules/indexes and server/API code remain but are dormant from the public product. A retention/export/deletion decision must precede backend removal.

## Legacy routes
`community.html`, `watch-rooms.html` and `watch-room-cinema.html` show a clear retirement notice and safe links back into Vivid. They do not load social controls or room mutation clients.

## Exit checks
- No community or Watch Rooms navigation destinations.
- Newsroom article reading and sharing remain available.
- Article comments and social reporting UI are absent.
- Service-worker cache no longer preloads retired screens/modules.
- Existing account, movie/TV/anime/live, library, download and install flows remain outside this change.
