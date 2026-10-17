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

const PLOT_ACTION_WORDS = new Set([
  "finds","found","discovers","discovered","uncovers","opens","inherits","steals","receives",
  "changes","changed","everything","something","someone","gets","getting","stops","stopped",
  "relives","wakes","waking","tries","attempts","save","stop","escape","protect","rescue",
  "kill","defeat","turns","becomes","starts","begins","reveals","returns","travels","goes"
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
  // Reserve a couple of retrieval slots for recognized story devices so a long
  // description cannot crowd its strongest concept out of TMDB keyword search.
  const result = [...new Set([...getPlotConceptPhrases(query).slice(0, 2), ...selected])].slice(0, safeLimit);
  for (const phrase of getPlotConceptPhrases(query)) {
    if (result.length >= safeLimit) break;
    if (!result.includes(phrase)) result.push(phrase);
  }
  return result.slice(0, safeLimit);
}

const PLOT_CONCEPTS = [
  { pattern: /\b(?:reliv\w*|repeats? the same day|same day repeats?|time loop|looping time|day repeats?|stuck in a loop|day starts? over)\b/i, phrases: ["time loop", "same day", "groundhog day", "repeats day"] },
  { pattern: /\b(?:magic\w* remote|remote control|control(?:s|led|ling)? time|stop(?:s|ped|ping)? time|pause(?:s|d)? time|freezes? time)\b/i, phrases: ["magic remote", "control time", "time manipulation"] },
  { pattern: /\b(?:body swap|swap(?:s|ped)? bodies|switch(?:es|ed)? bodies|wake up in each other(?:'s)? bodies|trades? bodies)\b/i, phrases: ["body swap", "identity swap"] },
  { pattern: /\b(?:lose(?:s|d)? (?:their |his |her )?memory|memory loss|can't remember who|amnesia|memories? (?:are )?erased)\b/i, phrases: ["memory loss", "amnesia", "lost memories"] },
  { pattern: /\b(?:parallel universe|alternate reality|another dimension|multiverse|different timeline)\b/i, phrases: ["parallel universe", "alternate reality", "multiverse"] },
  { pattern: /\b(?:haunted house|ghosts?|haunting|possessed|evil spirit)\b/i, phrases: ["haunted house", "ghost", "supernatural haunting"] },
  { pattern: /\b(?:alien invasion|aliens? (?:attack|arrive|invade)|extraterrestrial|from another planet)\b/i, phrases: ["alien invasion", "extraterrestrial", "first contact"] },
  { pattern: /\b(?:serial killer|multiple murders|detective investigates|investigates? a murder|solves? a murder)\b/i, phrases: ["serial killer", "murder investigation", "detective mystery"] },
  { pattern: /\b(?:kidnapp?ed|held hostage|trapped in|can't escape|cannot escape|locked in|locked room)\b/i, phrases: ["kidnapping", "held hostage", "trapped escape", "locked room mystery"] },
  { pattern: /\b(?:falls? in love|love triangle|fake dating|pretend(?:s|ing)? to date|pretends? to be (?:a )?couple)\b/i, phrases: ["love story", "fake dating", "love triangle"] },
  { pattern: /\b(?:travels? back in time|time travel|goes? back in time|future self|visits? the future)\b/i, phrases: ["time travel", "future self", "past and future"] },
  { pattern: /\b(?:predicts? (?:the future|what will happen|tomorrow)|sees? the future|visions? of the future|dreams? (?:about|of) (?:what happens|the future))\b/i, phrases: ["predicts future", "precognition", "future visions"] },
  { pattern: /\b(?:invisible|turns? invisible|becomes? invisible|can'?t be seen)\b/i, phrases: ["invisibility", "invisible person", "invisible man"] },
  { pattern: /\b(?:shrinks?|gets? smaller|tiny people|miniature world)\b/i, phrases: ["shrinking", "miniature world", "tiny people"] },
  { pattern: /\b(?:trapped in a (?:video )?game|inside a video game|game becomes? real|video game world)\b/i, phrases: ["trapped in game", "video game world", "game world"] },
  { pattern: /\b(?:stranded on (?:an? )?island|desert island|survives? (?:alone|on an island)|shipwrecked)\b/i, phrases: ["stranded island", "desert island", "survival story"] },
  { pattern: /\b(?:secret twin|long lost twin|mistaken identity|pretends? to be someone else|assumes? another identity)\b/i, phrases: ["secret twin", "mistaken identity", "secret identity"] },
  { pattern: /\b(?:cloned|clone|copies? of (?:himself|herself|themselves)|human replica)\b/i, phrases: ["human clone", "cloning", "duplicate person"] },
  { pattern: /\b(?:cursed object|ancient curse|curse follows|haunted doll|evil doll)\b/i, phrases: ["cursed object", "ancient curse", "haunted doll"] },
  { pattern: /\b(?:survival game|forced to compete|fight to survive|death game|last one standing)\b/i, phrases: ["survival game", "death game", "fight to survive"] },
  { pattern: /\b(?:zombie apocalypse|outbreak turns people|end of the world|world ends|last survivor)\b/i, phrases: ["zombie apocalypse", "apocalypse survival", "end of the world"] },
  { pattern: /\b(?:hidden world|secret world|magical kingdom|secret passage|discovers? a hidden)\b/i, phrases: ["hidden world", "secret world", "magical kingdom"] },
  { pattern: /\b(?:robot becomes? human|android|artificial intelligence|sentient robot|robot falls? in love)\b/i, phrases: ["sentient robot", "android", "artificial intelligence"] },
  { pattern: /\b(?:heist|steals? a (?:diamond|jewel|fortune|painting)|robbery crew|bank robbery)\b/i, phrases: ["heist", "bank robbery", "jewel theft"] },
  { pattern: /\b(?:treasure hunt|searches? for treasure|lost treasure|ancient artifact)\b/i, phrases: ["treasure hunt", "lost treasure", "ancient artifact"] },

  { pattern: /\b(?:turns? invisible|becomes? invisible|can(?:not|'t) be seen|disappears? from sight|invisibility|unseen by everyone)\b/i, phrases: ["invisibility", "invisible person", "disappears from sight"] },
  { pattern: /\b(?:shrinks?|gets? smaller|becomes? tiny|miniatur(?:e|ized)|tiny person|small as an? (?:ant|bug)|grows? huge)\b/i, phrases: ["shrinking", "tiny person", "giant"] },
  { pattern: /\b(?:goes? back in time|travels? to the past|travels? through time|visits? the future|from the future|future self|past and future)\b/i, phrases: ["time travel", "travels through time", "future self"] },
  { pattern: /\b(?:enters? (?:someone'?s? )?dreams?|dreams? become real|dream world|trapped in a dream|can't wake up|nightmare comes? true)\b/i, phrases: ["dream world", "enters dreams", "nightmare becomes real"] },
  { pattern: /\b(?:pets? (?:can )?talk|talking animals?|animals? speak|animals? act like people|dog talks?|cat talks?)\b/i, phrases: ["talking animals", "talking dog", "talking cat"] },
  { pattern: /\b(?:reads? minds?|hears? people'?s? thoughts|controls? minds?|mind control|takes? over (?:his|her|their) mind)\b/i, phrases: ["mind reading", "mind control", "telepathy"] },
  { pattern: /\b(?:can fly|flies? without wings|super strength|superpowers?|special powers?|has powers?|mutant powers?)\b/i, phrases: ["superpowers", "super strength", "mutant powers"] },
  { pattern: /\b(?:never ages?|does(?:n't| not) get old|lives? forever|cannot die|can't die|immortal|lives? for centuries)\b/i, phrases: ["immortality", "never ages", "cannot die"] },
  { pattern: /\b(?:comes? back to life|brought back to life|returns? from the dead|resurrected|revived after death)\b/i, phrases: ["resurrection", "returns from the dead", "brought back to life"] },
  { pattern: /\b(?:wakes? up as someone else|wakes? up in another body|becomes? another person|lives? someone else'?s? life|switch(?:es|ed)? lives?)\b/i, phrases: ["body swap", "identity swap", "someone else's life"] },
  { pattern: /\b(?:secret twin|evil twin|long lost twin|identical twin appears?|has a twin they never knew)\b/i, phrases: ["secret twin", "evil twin", "long lost twin"] },
  { pattern: /\b(?:kidnapped|taken hostage|held hostage|hostage situation|someone abducts?|abducted)\b/i, phrases: ["kidnapping", "hostage", "abduction"] },
  { pattern: /\b(?:stranded on an? island|marooned on an? island|lost at sea|shipwrecked|survives? on a deserted island)\b/i, phrases: ["stranded island", "lost at sea", "shipwreck survival"] },
  { pattern: /\b(?:stuck in space|lost in space|spaceship breaks? down|astronauts? stranded|space station disaster)\b/i, phrases: ["lost in space", "stranded in space", "space survival"] },
  { pattern: /\b(?:virtual reality|inside a video game|trapped in (?:a|the) game|game becomes? real|video game world|game is not real)\b/i, phrases: ["virtual reality", "trapped in game", "video game world"] },
  { pattern: /\b(?:experiment goes wrong|lab experiment|scientific experiment|experiment creates? a monster|test subject escapes?)\b/i, phrases: ["experiment gone wrong", "scientific experiment", "lab experiment"] },
  { pattern: /\b(?:framed for (?:a )?murder|wrongly accused|accused of a crime they didn't commit|innocent person on the run|falsely accused)\b/i, phrases: ["wrongly accused", "framed for murder", "innocent on the run"] },
  { pattern: /\b(?:undercover cop|cop goes undercover|pretends? to be a criminal|secret agent|undercover detective|fake identity)\b/i, phrases: ["undercover cop", "secret identity", "undercover agent"] },
  { pattern: /\b(?:pretends? to be rich|poor person becomes? rich|rich person becomes? poor|switch(?:es|ed)? places? with a rich person|rich and poor swap lives)\b/i, phrases: ["rich and poor", "switched lives", "becomes rich"] },
  { pattern: /\b(?:falls? into a parallel world|finds? a portal|portal to another world|enters? another dimension|doorway to another world)\b/i, phrases: ["portal to another world", "parallel universe", "another dimension"] },
  { pattern: /\b(?:curse follows?|cursed by a witch|witch puts? a spell|spell goes wrong|magical curse|bewitched)\b/i, phrases: ["curse", "witch spell", "magical curse"] },
  { pattern: /\b(?:chosen one|ancient prophecy|prophecy says?|destined to save|destiny to save the world)\b/i, phrases: ["chosen one", "ancient prophecy", "save the world"] },
  { pattern: /\b(?:fake relationship|pretend to be married|fake marriage|pretend couple|pretends? to date)\b/i, phrases: ["fake relationship", "pretend couple", "fake marriage"] },
  { pattern: /\b(?:witnesses? a murder|serial killer is after|killer hunts? them|detective tracks? a killer|murder mystery)\b/i, phrases: ["murder mystery", "serial killer", "killer hunt"] },
  { pattern: /\b(?:escapes? from prison|breaks? out of jail|wrongfully imprisoned|prison break|locked up for a crime)\b/i, phrases: ["prison escape", "prison break", "wrongful imprisonment"] },
  { pattern: /\b(?:lost child finds? (?:their )?family|orphan discovers? their parents|searches? for (?:his|her|their) real parents|adopted child discovers?)\b/i, phrases: ["lost child", "orphan", "search for real parents"] },
  { pattern: /\b(?:robot has feelings|robot wants? to be human|machine becomes? self aware|computer becomes? conscious|AI takes? over)\b/i, phrases: ["sentient robot", "artificial intelligence", "machine becomes conscious"] },
  { pattern: /\b(?:dinosaur(?:s)? (?:come back|return|escape)|brings? dinosaurs? back|prehistoric creatures? escape|park full of dinosaurs?)\b/i, phrases: ["dinosaurs", "prehistoric creatures", "dinosaur park"] },
  { pattern: /\b(?:finds? a secret room|hidden room behind|secret door in|discovers? a hidden passage|mysterious door leads?)\b/i, phrases: ["secret room", "hidden passage", "secret door"] },
  { pattern: /\b(?:loses? all (?:his|her|their) memories|wakes? up with no memory|can't remember who (?:they|he|she) is|forgets? (?:his|her|their) past)\b/i, phrases: ["amnesia", "memory loss", "lost memories"] },
  { pattern: /\b(?:people disappear overnight|whole town disappears|everyone vanishes|mysterious disappearances?)\b/i, phrases: ["mass disappearance", "people vanish", "mysterious disappearance"] },
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

/**
 * Extract high-signal, deterministic plot clues from a natural-language memory.
 * This is rule-based text processing, not an AI/model call.
 */
export function extractPlotClues(query = "", limit = 12) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const normalized = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const clues = [];
  const seen = new Set();
  const add = value => {
    const rawClue = String(value || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!rawClue || rawClue.length < 4 || rawClue.length > 64) return;
    const terms = words(rawClue).filter(term => !PLOT_ACTION_WORDS.has(term));
    if (!terms.length || terms.every(term => GENERIC_PLOT_WORDS.has(term))) return;
    const clue = terms.join(" ");
    if (clue.length < 4 || seen.has(clue)) return;
    seen.add(clue);
    clues.push(clue);
  };

  // Recognize story devices even when users describe them without the usual label.
  getPlotConceptPhrases(normalized).forEach(add);

  // Preserve meaningful action/object phrases as separate retrieval and ranking clues.
  const cluePatterns = [
    /(?:finds?|discovers?|uncovers?|opens?|inherits?|steals?|receives?)\s+(?:a|an|the|his|her|their)?\s*([a-z0-9]+(?:\s+[a-z0-9]+){0,2})/g,
    /(?:trapped|locked|stuck|stranded|lost)\s+(?:inside|in|on|at)?\s*(?:a|an|the)?\s*([a-z0-9]+(?:\s+[a-z0-9]+){0,2})/g,
    /(?:must|has to|tries to|attempts to)\s+(?:save|stop|escape|protect|find|rescue|kill|defeat)\s+(?:a|an|the|his|her|their)?\s*([a-z0-9]+(?:\s+[a-z0-9]+){0,2})/g
  ];
  for (const pattern of cluePatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const value = match[1] || "";
      if (!/^(?:man|woman|boy|girl|kid|child|person|people|thing|something|someone|place|way|lot|life|world|time|day)$/i.test(value.trim())) add(value);
    }
  }

  // A few high-information adjacent phrases give catalogue search alternate wording.
  const tokens = words(normalized);
  for (const size of [3, 2]) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const phrase = tokens.slice(i, i + size).join(" ");
      const specificity = tokens.slice(i, i + size).filter(term => !GENERIC_PLOT_WORDS.has(term)).length;
      if (specificity === size && phrase.length >= 8) add(phrase);
    }
  }
  return clues.slice(0, Math.max(1, Math.min(16, Number(limit) || 12)));
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

const PLOT_TERM_EQUIVALENTS = [
  ["kid", "child", "children", "little one"],
  ["guy", "man", "dude", "fellow"],
  ["lady", "woman"],
  ["cop", "police", "officer", "detective"],
  ["alien", "extraterrestrial"],
  ["robot", "android", "machine"],
  ["ghost", "spirit", "phantom"],
  ["monster", "creature", "beast"],
  ["magic", "magical", "enchanted"],
  ["tiny", "small", "little", "miniature"],
  ["invisible", "unseen", "invisibility"],
  ["rich", "wealthy", "millionaire"],
  ["poor", "broke", "penniless"],
  ["car", "vehicle", "automobile"],
  ["spaceship", "spacecraft", "starship"],
  ["steal", "stole", "stolen", "rob"],
  ["find", "found", "discover", "discovers", "discovered"],
  ["kill", "murder", "slay"],
  ["die", "dies", "dead", "death", "dies"],
  ["kidnap", "kidnapped", "abduct", "abducted"],
  ["scared", "afraid", "terrified", "frightened"],
  ["funny", "comedy", "hilarious"],
  ["love", "romance", "romantic"],
  ["future", "tomorrow", "upcoming"],
  ["past", "history", "earlier"]
].map(group => new Set(group));

function termMatches(term, searchable) {
  if (searchable.has(term)) return true;
  // Catalogue synopses often use "magical" where a user says "magic".
  // Treat this as a narrow synonym, not a broad fuzzy match that creates noise.
  if ((term === "magic" && searchable.has("magical")) ||
      (term === "magical" && searchable.has("magic"))) return true;
  if (PLOT_TERM_EQUIVALENTS.some(group => group.has(term) && [...group].some(word => searchable.has(word)))) return true;
  const stem = term.length > 5 ? term.replace(/(?:ing|ed|es|s)$/, "") : term;
  if (stem.length >= 3 && searchable.has(stem)) return true;
  return term.length > 5 && [...searchable].some(word =>
    word.length > 5 && (word.startsWith(term) || term.startsWith(word)) &&
    Math.abs(word.length - term.length) <= 3
  );
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
  const semanticClues = [...new Set([
    ...extractPlotClues(query, 12),
    ...(Array.isArray(clues) ? clues : [])
  ].map(clue => String(clue || "").trim().slice(0, 100))
    .filter(clue => clue.length >= 3))].slice(0, 12);
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
    const distinctClues = clueScores.length;
    const baseScore = Math.max(queryScore, clueScores[0] || 0);
    if (baseScore <= 0) return;

    const fields = candidateFields(item);
    const candidateTerms = new Set((fields.title + " " + fields.overview).split(/\s+/).filter(Boolean));
    const queryTerms = [...new Set([...words(query), ...semanticClues.flatMap(clue => words(clue)), ...getPlotConceptPhrases(query).flatMap(clue => words(clue))])];
    const matchedTerms = queryTerms.filter(term => termMatches(term, candidateTerms));
    const idf = matchedTerms.length
      ? matchedTerms.reduce((sum, term) => sum + Math.log(1 + (totalDocuments - (documentFrequency.get(term) || 0) + 0.5) / ((documentFrequency.get(term) || 0) + 0.5)), 0) / matchedTerms.length
      : 0;
    // Multiple independently matching clues are stronger evidence than one broad word.
    const corroboration = Math.min(7, (clueScores[1] || 0) * 0.6 + Math.max(0, distinctClues - 2) * 0.9);
    const queryCoverage = Math.min(1, matchedTerms.length / Math.max(2, queryTerms.length));
    const conceptPhrases = getPlotConceptPhrases(query);
    const conceptHits = conceptPhrases.filter(phrase => {
      const phraseTerms = words(phrase);
      return phraseTerms.length > 0 && phraseTerms.every(term => termMatches(term, candidateTerms));
    }).length;
    // Reward candidates that support multiple distinct story devices, not just
    // one highly repeated trope such as a character reliving the same day.
    const conceptCorroboration = Math.min(6, Math.max(0, conceptHits - 1) * 2.25);
    const distinctiveObjectHit = /\b(?:remote|device|watch|button|phone|mirror|door|book|tape|camera|mask|key|letter|toy|machine)\b/i.test(query) && semanticClues.some(clue => /\b(?:remote|device|watch|button|phone|mirror|door|book|tape|camera|mask|key|letter|toy|machine)\b/i.test(clue) && words(clue).every(term => termMatches(term, candidateTerms)));
    const objectCorroboration = distinctiveObjectHit ? 6 : 0;
    const plotScore = Number((baseScore * (0.78 + Math.min(1.25, idf * 0.35)) + corroboration + queryCoverage * 1.2 + conceptCorroboration + objectCorroboration).toFixed(3));
    const previous = scored.get(identity);
    if (!previous || plotScore > previous.plotScore) scored.set(identity, { ...item, plotScore });
  });
  return [...scored.values()].sort((a, b) => b.plotScore - a.plotScore);
}
