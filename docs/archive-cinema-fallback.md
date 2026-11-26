# Archive Cinema fallback

Archive Cinema is an additional discovery source in Player 1 for movie pages. It searches Internet Archive movie records, checks each candidate's metadata, and offers only records that have a browser-playable video file plus an explicit public-domain or commercial Creative Commons rights declaration.

## Flow

1. Search the Internet Archive Advanced Search API for movie records matching the requested title.
2. Fetch each candidate's metadata record.
3. Reject candidates without a public-domain declaration or a supported commercial Creative Commons license.
4. Reject non-commercial (NC), no-derivatives (ND), private, and non-video files.
5. Open the selected item using the Internet Archive's own embedded player. Vivid does not proxy, mirror, download, or re-host the media.

Accepted declarations are Public Domain Mark, CC0, CC BY and CC BY-SA. The archive item details page is linked beside every result so viewers can inspect the source and rights statement.

## Important rights limitation

Internet Archive says that rights information is often supplied by the uploader and that it cannot guarantee the accuracy of uploader-provided copyright information. Therefore this filter is a conservative metadata screen, not legal verification or a guarantee that a title is public domain. The UI discloses this limitation and links to the original item. Do not describe every returned title as verified public domain. Remove or disable any item if a rights holder disputes its status.

Internet Archive's own guidance:
- https://archivesupport.zendesk.com/hc/en-us/articles/360014759692-Rights
- https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide

## Playback behavior

- Available on movie watch pages only; Free Anime and Premium Anime source restrictions remain unchanged.
- Uses Player 1's existing iframe and the Archive's official embed URL.
- Archive playback is user-selected and is not part of automatic server failover.
- The archive player controls playback, subtitles, quality and progress. Vivid cannot inspect its cross-origin iframe internals.
- Search is limited to 12 catalogue hits and checks metadata for up to 10 candidates per search. Searches time out after 15 seconds.
