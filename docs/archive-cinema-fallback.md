# Archive Cinema playback source

Internet Archive is available as a selectable source in Player 1 on movie watch pages. Viewers can choose it directly from the server picker, search the archive catalogue, inspect the original item and its rights declaration, and play a selected listing in the existing player. It also remains available as a last-resort discovery option after Vivid's normal movie sources have been exhausted.

## Flow

1. The viewer selects **Internet Archive** in the Player 1 server picker, or Vivid reveals the catalogue after its normal movie sources are exhausted.
2. Search the Internet Archive Advanced Search API for movie records matching the requested title.
3. Fetch each candidate's metadata record.
4. Reject candidates without a public-domain declaration or a supported commercial Creative Commons license.
5. Reject non-commercial (NC), no-derivatives (ND), private, and non-video files.
6. Open the selected item using the Internet Archive's own embedded player. Vivid does not proxy, mirror, download, or re-host the media.

Accepted declarations are Public Domain Mark, CC0, CC BY and CC BY-SA. The archive item details page is linked beside every result so viewers can inspect the source and rights statement.

## Important rights limitation

Internet Archive says that rights information is often supplied by the uploader and that it cannot guarantee the accuracy of uploader-provided copyright information. Therefore this filter is a conservative metadata screen, not legal verification or a guarantee that a title is public domain. The UI discloses this limitation and links to the original item. Remove or disable any item if a rights holder disputes its status.

Internet Archive guidance:
- https://archivesupport.zendesk.com/hc/en-us/articles/360014759692-Rights
- https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide

## Playback behavior

- Available only on movie watch pages; never exposed to Free Anime or Premium Anime.
- Catalogue requests begin only after the viewer selects Internet Archive or after Vivid's movie servers are exhausted.
- Uses Player 1's existing iframe and the Archive's official embed URL.
- Archive playback is user-selected and is not part of automatic server failover.
- The archive player controls playback, subtitles, quality and progress. Vivid cannot inspect its cross-origin iframe internals.

## Library of Congress expansion

The Library of Congress National Screening Room remains a separate planned source. Its API exposes heterogeneous item and resource records, and item-level rights/access conditions vary. Do not show it as a playable source until the integration can identify a real playable media resource and preserve the item's rights/access notices. See the official [National Screening Room rights and access guidance](https://www.loc.gov/collections/national-screening-room/about-this-collection/rights-and-access/) and [Library of Congress streaming API documentation](https://www.loc.gov/apis/micro-services/streaming-services/).
