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
 * Conservative release gate. It intentionally rejects ambiguous results:
 * movies need the exact title phrase and selected release year; episodes need
 * the exact series phrase and exact SxxExx (or NxNN) coordinates.
 */
export function matchesSelectedRelease(media, result) {
  if (!media || !result || typeof result.title !== "string") return false;
  const titleWords = WORDS(media.title);
  const releaseWords = WORDS(result.title);
  const titleStart = sequenceIndex(releaseWords, titleWords);
  if (titleStart < 0) return false;
  const allowedReleasePrefixes = new Set(["yts", "mx", "rarbg", "1337x", "eztv", "ettv", "torrent", "download", "www", "galaxy", "evo", "ntb", "ctrlhd"]);
  if (releaseWords.slice(0, titleStart).some(word => !allowedReleasePrefixes.has(word))) return false;
  if (/\b(?:fan[\s._-]*edit|fanmade|parody|trailer|teaser|sample|clip|workprint)\b/i.test(result.title)) return false;

  if (media.media_type === "tv") {
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
  const years = [...new Set(result.title.match(/\b(?:19|20)\d{2}\b/g) || [])];
  return years.includes(year) && years.every(candidate => candidate === year);
}
