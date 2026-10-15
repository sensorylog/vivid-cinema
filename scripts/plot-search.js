const STOPWORDS = new Set([
  "a","an","the","and","or","but","to","of","in","on","at","by","for","from","with","about",
  "into","over","after","before","during","when","where","which","who","that","this","these",
  "those","there","their","they","them","his","her","its","our","your","you","i","me","my",
  "we","he","she","it","is","are","was","were","be","been","being","has","have","had","do",
  "does","did","can","could","would","should","will","might","must","as","if","then","than",
  "movie","movies","film","films","show","series","title","remember","remembered","watched",
  "watch","saw","seen","one","something","someone","thing","kind","sort","like","really",
  "find","looking","trying","what","whats","name","called","forgot","forget"
]);

const GENERIC_PLOT_WORDS = new Set(["man","woman","boy","girl","kid","child","family","person","people","day","time","life","world","friend","friends","year","home","city","town","young","old"]);
const HIGH_VALUE_CLUES = new Set([
  "time loop","same day","time travel","time machine","magic remote","body swap",
  "memory loss","parallel universe","alternate reality","haunted house","alien invasion",
  "secret identity","serial killer","groundhog day","repeats day"
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
  const groups = { 3: [], 2: [], 1: [] };
  const add = (phrase, size) => {
    if (!phrase || groups[size].some(item => item.phrase === phrase)) return;
    const parts = phrase.split(" ");
    const specificity = parts.reduce((sum, token) =>
      sum + (GENERIC_PLOT_WORDS.has(token) ? 0.45 : 1.15) + Math.min(token.length, 10) * 0.08, 0);
    groups[size].push({ phrase, weight: specificity + size * 0.45 + (HIGH_VALUE_CLUES.has(phrase) ? 5 : 0) });
  };

  for (const size of [3, 2]) {
    for (let i = 0; i <= tokens.length - size; i++) {
      add(tokens.slice(i, i + size).join(" "), size);
    }
  }
  tokens.forEach(token => add(token, 1));
  for (const size of [3, 2, 1]) {
    groups[size].sort((a, b) => b.weight - a.weight || b.phrase.length - a.phrase.length);
  }

  // Rotate across phrase sizes so a long three-word phrase cannot crowd out
  // useful two-word catalogue keywords such as "time loop" or "magic remote".
  const order = [2, 3, 1];
  const cursors = { 3: 0, 2: 0, 1: 0 };
  const selected = [];
  const seen = new Set();
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 8));
  while (selected.length < safeLimit) {
    let added = false;
    for (const size of order) {
      const item = groups[size][cursors[size]++];
      if (!item) continue;
      added = true;
      if (seen.has(item.phrase)) continue;
      seen.add(item.phrase);
      selected.push(item.phrase);
      if (selected.length >= safeLimit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function scorePlotCandidate(query = "", candidate = {}) {
  const queryWords = [...new Set(words(query))];
  if (!queryWords.length) return 0;
  const normalizeText = value => String(value || "").toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  const title = normalizeText(candidate.title || candidate.name || candidate.raw?.title || candidate.raw?.name);
  const overview = normalizeText(candidate.overview || candidate.raw?.overview || "");
  const searchable = " " + (title + " " + overview).trim() + " ";
  const titleSearchable = " " + title + " ";
  let matches = 0;
  let strongMatches = 0;
  let score = 0;
  for (const word of queryWords) {
    const stem = word.length > 5 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;
    const matched = searchable.includes(" " + word + " ") ||
      (stem.length >= 3 && searchable.includes(" " + stem + " "));
    if (!matched) continue;
    matches++;
    const generic = GENERIC_PLOT_WORDS.has(word);
    if (!generic) strongMatches++;
    const weight = generic ? 0.55 : word.length >= 7 ? 1.35 : 1;
    score += (titleSearchable.includes(" " + word + " ") ? 2.5 : 1) * weight;
  }
  // A single generic overlap ("man", "day", "family") is not evidence enough.
  if (matches < (queryWords.length >= 4 ? 2 : 1)) return 0;
  if (queryWords.length >= 4 && strongMatches < 2 && matches < 3) return 0;
  const coverage = matches / queryWords.length;
  return Number((score + coverage * 5).toFixed(3));
}

export function scorePlotCandidates(query = "", candidates = []) {
  const scored = new Map();
  for (const item of candidates || []) {
    if (item?.id == null) continue;
    const identity = (item.media_type || "movie") + ":" + String(item.id);
    const plotScore = scorePlotCandidate(query, item);
    if (plotScore <= 0) continue;
    const previous = scored.get(identity);
    if (!previous || plotScore > previous.plotScore) {
      scored.set(identity, { ...item, plotScore });
    }
  }
  return [...scored.values()].sort((a, b) => b.plotScore - a.plotScore);
}
