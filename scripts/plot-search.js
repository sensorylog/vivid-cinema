const STOPWORDS = new Set([
  "a","an","the","and","or","but","to","of","in","on","at","by","for","from","with","about",
  "into","over","after","before","during","when","where","which","who","that","this","these",
  "those","there","their","they","them","his","her","its","our","your","you","i","me","my",
  "we","he","she","it","is","are","was","were","be","been","being","has","have","had","do",
  "does","did","can","could","would","should","will","might","must","as","if","then","than",
  "movie","movies","film","films","show","series","title","remember","remembered","watched",
  "watch","saw","seen","one","something","someone","thing","kind","sort","like","really",
  "find","looking","trying","trying","what","whats","name","called","forgot","forget"
]);

function words(value) {
  return String(value || "").toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter(word => word.length >= 3 && !STOPWORDS.has(word));
}

export function isPlotDescriptionQuery(query = "") {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return false;
  const cue = /\b(?:i remember|i watched|i saw|can't remember|cannot remember|forgot the title|what(?:'s| is) the (?:movie|film|show)|which (?:movie|film|show)|there(?:'s| is) (?:a )?(?:movie|film|show)|(?:movie|film|show) (?:where|about|in which)|story (?:where|about)|plot (?:where|about|is)|the one where|a (?:man|woman|boy|girl|kid|child|family|person) who)\b/i;
  const narrative = /\b(?:discovers|finds|wakes|relives|gets stuck|is trapped|escapes|tries to|has to|turns out|meets|must save|falls in love|travels back|goes back|survives|becomes|is forced to|searches for|repeats the same)\b/i;
  const wordCount = words(text).length;
  return (cue.test(text) && wordCount >= 2) || (wordCount >= 6 && narrative.test(text));
}

export function buildPlotKeywordQueries(query = "", limit = 8) {
  const tokens = words(query);
  if (!tokens.length) return [];
  const phrases = [];
  for (const size of [3, 2]) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const phrase = tokens.slice(i, i + size).join(" ");
      if (phrase.length >= 7) phrases.push({ phrase, size, weight: phrase.length + (size === 2 ? 2 : 0) });
    }
  }
  const unique = new Map();
  phrases.sort((a, b) => b.weight - a.weight).forEach(item => {
    if (!unique.has(item.phrase)) unique.set(item.phrase, item);
  });
  // Single concepts help when the description contains only one distinctive clue.
  tokens.slice().sort((a, b) => b.length - a.length).forEach(token => {
    if (!unique.has(token)) unique.set(token, { phrase: token, size: 1, weight: token.length - 1 });
  });
  return [...unique.values()].sort((a, b) => b.weight - a.weight).slice(0, Math.max(1, Math.min(10, limit))).map(item => item.phrase);
}

export function scorePlotCandidate(query = "", candidate = {}) {
  const queryWords = [...new Set(words(query))];
  if (!queryWords.length) return 0;
  const title = String(candidate.title || candidate.name || candidate.raw?.title || candidate.raw?.name || "").toLowerCase();
  const overview = String(candidate.overview || candidate.raw?.overview || "").toLowerCase();
  const searchable = " " + (title + " " + overview).replace(/[^a-z0-9]+/g, " ") + " ";
  const titleSearchable = " " + title.replace(/[^a-z0-9]+/g, " ") + " ";
  let matches = 0;
  let score = 0;
  for (const word of queryWords) {
    const stem = word.length > 5 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;
    const matched = searchable.includes(" " + word + " ") || (stem.length >= 3 && searchable.includes(" " + stem + " "));
    if (matched) {
      matches++;
      score += titleSearchable.includes(" " + word + " ") ? 2.5 : 1;
    }
  }
  // One generic overlap (for example, just “man” or “day”) is not enough
  // to claim a plot match for a detailed description.
  if (matches < (queryWords.length >= 4 ? 2 : 1)) return 0;
  const coverage = matches / queryWords.length;
  return Number((score + coverage * 5).toFixed(3));
}
