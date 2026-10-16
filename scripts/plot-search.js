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
  const narrative = /\b(?:discovers?|finds?|wakes?|relives?|gets? stuck|gets? lost|is trapped|is chased|tries? to|has to|turns? out|meets?|must save|falls? in love|travels? back|goes? back|survives?|becomes?|is forced to|searches? for|repeats? the same|lives? in|works? as|ends? up|takes? place|follows?|returns?|enters?|leaves?|loses?|hides?|reveals?|starts? to|wants? to|needs? to|accidentally|secretly)\b/i;
  const rawWordCount = text.match(/[a-z0-9]+/g)?.length || 0;
  const contentWordCount = words(text).length;
  // Catch natural plot recollections even when they lack "I remember" or
  // "the movie where" phrasing, before they fall into ordinary recommendations.
  const sentenceLikePlot = rawWordCount >= 8 && contentWordCount >= 5 && narrative.test(text);
  return (cue.test(text) && contentWordCount >= 2) || sentenceLikePlot || (contentWordCount >= 6 && narrative.test(text));
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
  const result = [...selected];
  for (const phrase of getPlotConceptPhrases(query)) {
    if (result.length >= safeLimit) break;
    if (!result.includes(phrase)) result.push(phrase);
  }
  return result.slice(0, safeLimit);
}

const PLOT_CONCEPTS = [
  { pattern: /\b(?:reliv\w*|repeats? the same day|same day repeats?|time loop|looping time|day repeats?)\b/i, phrases: ["time loop", "same day", "groundhog day", "repeats day"] },
  { pattern: /\b(?:magic\w* remote|remote control|control(?:s|led|ling)? time|stop(?:s|ped|ping)? time|pause(?:s|d)? time)\b/i, phrases: ["magic remote", "control time", "time manipulation"] },
  { pattern: /\b(?:body swap|swap(?:s|ped)? bodies|switch(?:es|ed)? bodies|wake up in each other(?:'s)? bodies)\b/i, phrases: ["body swap", "identity swap"] },
  { pattern: /\b(?:lose(?:s|d)? (?:their |his |her )?memory|memory loss|can't remember who|amnesia)\b/i, phrases: ["memory loss", "amnesia", "lost memories"] },
  { pattern: /\b(?:parallel universe|alternate reality|another dimension|multiverse)\b/i, phrases: ["parallel universe", "alternate reality", "multiverse"] },
  { pattern: /\b(?:haunted house|ghosts?|haunting|possessed)\b/i, phrases: ["haunted house", "ghost", "supernatural haunting"] },
  { pattern: /\b(?:alien invasion|aliens? (?:attack|arrive|invade)|extraterrestrial)\b/i, phrases: ["alien invasion", "extraterrestrial", "first contact"] },
  { pattern: /\b(?:serial killer|multiple murders|detective investigates|investigates? a murder)\b/i, phrases: ["serial killer", "murder investigation", "detective mystery"] },
  { pattern: /\b(?:kidnapp?ed|held hostage|trapped in|can't escape|cannot escape)\b/i, phrases: ["kidnapping", "held hostage", "trapped escape"] },
  { pattern: /\b(?:falls? in love|love triangle|fake dating|pretend(?:s|ing)? to date)\b/i, phrases: ["love story", "fake dating", "love triangle"] },
  { pattern: /\b(?:travels? back in time|time travel|goes? back in time|future self)\b/i, phrases: ["time travel", "future self", "past and future"] }
];

export function getPlotConceptPhrases(query = "") {
  const text = String(query || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const phrases = [];
  for (const concept of PLOT_CONCEPTS) {
    if (!concept.pattern.test(text)) continue;
    for (const phrase of concept.phrases) if (!phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases.slice(0, 10);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function candidateFields(candidate = {}) {
  const source = candidate.raw || candidate;
  const title = normalizeSearchText(candidate.title || candidate.name || source.title || source.name);
  const overview = normalizeSearchText(candidate.overview || source.overview || "");
  return { title, overview, all: " " + title + " " + overview + " " };
}

function termMatches(term, searchable) {
  if (searchable.has(term)) return true;
  const stem = term.length > 5 ? term.replace(/(?:ing|ed|es|s)$/, "") : term;
  return stem.length >= 3 && searchable.has(stem);
}

/**
 * Experimental browser-side plot matching: weighted term overlap, phrase
 * matches, and hand-built concept expansions. No hosted AI model is called.
 */
export function scorePlotCandidate(query = "", candidate = {}) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return 0;
  const fields = candidateFields(candidate);
  const searchable = new Set((fields.title + " " + fields.overview).split(/\s+/).filter(Boolean));
  const titleTerms = new Set(fields.title.split(/\s+/).filter(Boolean));
  const queryTerms = [...new Set(words(rawQuery))];
  if (!queryTerms.length) return 0;

  let score = 0;
  let matches = 0;
  let strongMatches = 0;
  let matchedWeight = 0;
  const seen = new Set();
  const phraseQueries = [rawQuery, ...getPlotConceptPhrases(rawQuery)];
  const expandedTerms = [];
  for (const phrase of phraseQueries) {
    for (const term of words(phrase)) {
      if (!expandedTerms.some(entry => entry.term === term)) expandedTerms.push({ term, weight: phrase === rawQuery ? 1 : 0.72 });
    }
  }

  for (const entry of expandedTerms) {
    if (!termMatches(entry.term, searchable)) continue;
    const generic = GENERIC_PLOT_WORDS.has(entry.term);
    const weight = entry.weight * (generic ? 0.35 : entry.term.length >= 7 ? 1.35 : 1);
    const titleMatch = termMatches(entry.term, titleTerms);
    score += weight * (titleMatch ? 2.6 : 1);
    matchedWeight += entry.weight;
    if (!seen.has(entry.term)) {
      seen.add(entry.term);
      matches++;
      if (!generic) strongMatches++;
    }
  }

  for (const phrase of phraseQueries) {
    const normalizedPhrase = normalizeSearchText(phrase);
    if (normalizedPhrase.length >= 7 && fields.all.includes(" " + normalizedPhrase + " ")) score += phrase === rawQuery ? 2.2 : 1.6;
  }

  if (matches < (queryTerms.length >= 4 ? 2 : 1)) return 0;
  if (queryTerms.length >= 4 && strongMatches < 2 && matches < 3) return 0;
  const coverage = Math.min(1, matchedWeight / Math.max(1, queryTerms.length));
  return Number((score + coverage * 3).toFixed(3));
}

/**
 * Rank catalogue candidates with a lightweight TF-IDF-style adjustment so
 * distinctive clues count more than terms shared by almost every synopsis.
 */
export function scorePlotCandidates(query = "", candidates = [], clues = []) {
  const semanticClues = [...new Set((Array.isArray(clues) ? clues : [])
    .map(clue => String(clue || "").trim().slice(0, 100))
    .filter(clue => clue.length >= 3))].slice(0, 8);
  const input = (candidates || []).filter(item => item?.id != null);
  const corpus = input.map(item => {
    const fields = candidateFields(item);
    return new Set((fields.title + " " + fields.overview).split(/\s+/).filter(Boolean));
  });
  const documentFrequency = new Map();
  for (const terms of corpus) for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  const totalDocuments = Math.max(1, corpus.length);
  const scored = new Map();

  input.forEach(item => {
    const identity = (item.media_type || "movie") + ":" + String(item.id);
    const queryScore = scorePlotCandidate(query, item);
    const clueScores = semanticClues.map(clue => scorePlotCandidate(clue, item)).filter(score => score > 0).sort((a, b) => b - a);
    const baseScore = Math.max(queryScore, clueScores[0] || 0);
    if (baseScore <= 0) return;

    const fields = candidateFields(item);
    const candidateTerms = new Set((fields.title + " " + fields.overview).split(/\s+/).filter(Boolean));
    const queryTerms = [...new Set([...words(query), ...semanticClues.flatMap(clue => words(clue)), ...getPlotConceptPhrases(query).flatMap(clue => words(clue))])];
    const matchedTerms = queryTerms.filter(term => termMatches(term, candidateTerms));
    const idf = matchedTerms.length
      ? matchedTerms.reduce((sum, term) => sum + Math.log(1 + (totalDocuments - (documentFrequency.get(term) || 0) + 0.5) / ((documentFrequency.get(term) || 0) + 0.5)), 0) / matchedTerms.length
      : 0;
    const corroboration = Math.min(3, (clueScores[1] || 0) * 0.2);
    const plotScore = Number((baseScore * (0.8 + Math.min(1.2, idf * 0.35)) + corroboration).toFixed(3));
    const previous = scored.get(identity);
    if (!previous || plotScore > previous.plotScore) scored.set(identity, { ...item, plotScore });
  });
  return [...scored.values()].sort((a, b) => b.plotScore - a.plotScore);
}
