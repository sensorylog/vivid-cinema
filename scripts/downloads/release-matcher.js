const WORDS = value => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean);

function sequenceIndex(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return -1;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) return index;
  }
  return -1;
}

/**
 * Conservative release gate. Movies require the exact title and release year;
 * episodes require the exact series and episode coordinates. Unknown title
 * prefixes and obvious non-feature listings are rejected rather than guessed.
 */
export function matchesSelectedRelease(media, result) {
  if (!media || !result || typeof result.title !== "string") return false;
  const titleWords = WORDS(media.title);
  const releaseWords = WORDS(result.title);
  const titleStart = sequenceIndex(releaseWords, titleWords);
  if (titleStart < 0) return false;

  const allowedReleasePrefixes = new Set(["yts", "mx", "rarbg", "1337x", "eztv", "ettv", "torrent", "download", "www", "galaxy", "evo", "ntb", "ctrlhd"]);
  const end = titleStart + titleWords.length;
  if (media.media_type === "tv") {
    if (releaseWords.slice(0, titleStart).some(word => !allowedReleasePrefixes.has(word))) return false;
    if (/\b(?:fan[\s._-]*edit|fanmade|parody|trailer|teaser|sample|clip|workprint)\b/i.test(result.title)) return false;
    const season = Number(media.season);
    const episode = Number(media.episode);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 0) return false;
    const text = result.title.toLowerCase();
    const coordinates = [
      new RegExp("\\bs" + String(season).padStart(2, "0") + "e" + String(episode).padStart(2, "0") + "\\b", "i"),
      new RegExp("\\b" + season + "x" + String(episode).padStart(2, "0") + "\\b", "i")
    ];
    return coordinates.some(pattern => pattern.test(text));
  }

  if (media.media_type !== "movie") return false;
  const year = String(media.year ?? "").match(/^(19|20)\d{2}$/)?.[0];
  if (!year) return false;
  const releaseYears = releaseWords
    .map((word, index) => ({ word, index }))
    .filter(item => item.index < titleStart || item.index >= end)
    .filter(item => /^(19|20)\d{2}$/.test(item.word))
    .map(item => item.word);
  if (!releaseYears.includes(year) || releaseYears.some(candidate => candidate !== year)) return false;
  const yearAfterTitle = releaseWords.findIndex((word, index) => index >= end && word === year);
  if (yearAfterTitle >= 0 && yearAfterTitle !== end) return false;
  if (releaseWords.slice(0, titleStart).some(word => word !== year && !allowedReleasePrefixes.has(word))) return false;
  if (/\b(?:fan[\s._-]*edit|fanmade|parody|trailer|teaser|sample|clip|workprint)\b/i.test(result.title)) return false;
  return true;
}
