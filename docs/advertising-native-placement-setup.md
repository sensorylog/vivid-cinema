# Vivid native advertising placements

Vivid keeps ad rendering centralized in `scripts/advertising.js`. The primary Adsterra Native Banner unit remains enabled. A second placement position is prepared on each approved browsing page, but the secondary unit stays disabled until Vivid has a distinct Adsterra Native Banner zone.

## Activate the second native unit

1. Create a separate Native Banner zone in the Adsterra publisher dashboard for the Vivid domain.
2. Copy that zone's script URL and its unique container ID.
3. Set `nativeBannerUnits.secondary.enabled` to `true` and enter the exact `src` and `containerId` supplied by Adsterra.
4. Keep the secondary zone's container ID distinct from the primary zone.
5. Run `npm test` and `npm run check:syntax`.
6. Verify real browser impressions, creative sizing, CSP console output, and layout on mobile and desktop before enabling it in production.

## Placement map

- Home: primary after the catalogue explorer; secondary after Top 10.
- Discover: primary after results; secondary after the browse filters.
- Collections: primary after the results area; secondary after collection controls.
- For You: primary after recommendations; secondary after quick filters.
- Anime: primary after the catalogue; secondary after anime controls.

The secondary positions are inert until a separate zone is configured. Do not copy the primary zone's script/container ID into the secondary unit. The two native slots per page are a hard ceiling, and the session request cap remains eight. Player, Watch Room, Live TV, authentication, account, and offline pages remain excluded.

## User experience and disclosure

Every native placement retains the visible "Sponsored" label. Ad creatives are never styled to impersonate Vivid movie cards or controls, and placements are kept outside playback surfaces. Native creative containers do not impose a maximum height or hide overflow, so provider creatives are not cropped.
