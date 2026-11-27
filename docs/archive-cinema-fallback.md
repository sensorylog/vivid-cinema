# Open Film Sources in Vivid Cinema

Player 1 offers three selectable catalogues for movie pages: Internet Archive, Wikimedia Commons and the Library of Congress. They are independent of Vivid's normal third-party embed servers and are also available as a last-resort discovery option after normal movie servers fail.

## Internet Archive

Searches the Internet Archive Advanced Search API, fetches each candidate's metadata, and offers the official archive embed only when the record declares a public-domain or supported commercial Creative Commons licence and includes a playable video file. Accepted declarations are Public Domain Mark, CC0, CC BY and CC BY-SA. Non-commercial and no-derivatives licences are rejected. Uploader-supplied rights declarations are not independently verified.

## Wikimedia Commons

Searches the Commons API for video files and uses each file's own extended metadata. Only direct HTTPS MP4, WebM or OGV files with a public-domain, CC0, CC BY or CC BY-SA declaration are offered. The original Commons file page is linked beside every result. Browser codec support varies by format.

## Library of Congress

Searches the official loc.gov film-and-video JSON endpoint, then fetches each item's detail record and digital resources. It only offers an MP4 resource when the item has an explicit public-domain, compatible Creative Commons, or "No known restrictions on publication/use" rights advisory. The latter is shown as an advisory, not a guarantee of public-domain status. Items with undetermined rights or no playable MP4 are excluded. The original item record is linked for inspection.

The Library of Congress says the National Screening Room includes both copyrighted and public-domain works; item-level rights/access checks are therefore mandatory. The LOC API documents distinct search, item and resource endpoints, and the collection notes that most titles are available as MP4 downloads. See [LOC National Screening Room](https://www.loc.gov/collections/national-screening-room/about-this-collection/), [LOC API endpoints](https://www.loc.gov/apis/json-and-yaml/requests/endpoints/), and [LOC streaming services](https://www.loc.gov/apis/micro-services/streaming-services/).

## Playback and limitations

- All three catalogues are available only for movie playback, never Free Anime or Premium Anime.
- Internet Archive uses its official embedded player. Commons and LOC use their direct MP4/WebM/OGV files in Vivid's native HTML5 video element.
- Catalogue requests begin when a user selects a source or when the normal movie servers are exhausted.
- The sources are archives of public-domain/openly licensed material, not substitutes for current commercial streaming catalogues. Most new studio releases will not be available here.
- Vivid does not proxy, mirror, download or re-host these files. Source availability, formats, playback restrictions and rights metadata can change; users can open the original item record.
- The source picker keeps Vivid's existing commercial embed providers unchanged.
