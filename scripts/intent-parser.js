const GENRES = Object.freeze({
  action: { name: "Action", movieId: 28, tvId: 10759, tvLabel: "Action & Adventure", tvNote: "TMDB combines TV Action and Adventure into one genre, so series results may include both.", aliases: ["action-packed", "intense"] },
  adventure: { name: "Adventure", movieId: 12, tvId: 10759, tvLabel: "Action & Adventure", tvNote: "TMDB combines TV Action and Adventure into one genre, so series results may include both.", aliases: ["adventurous"] },
  animation: { name: "Animation", movieId: 16, tvId: 16, aliases: ["animated"] },
  comedy: { name: "Comedy", movieId: 35, tvId: 35, aliases: ["funny", "hilarious", "comedic"] },
  crime: { name: "Crime", movieId: 80, tvId: 80, aliases: ["gangster", "gangsta"] },
  documentary: { name: "Documentary", movieId: 99, tvId: 99, aliases: ["real stories", "nonfiction", "non-fiction"] },
  drama: { name: "Drama", movieId: 18, tvId: 18, aliases: ["dramatic"] },
  family: { name: "Family", movieId: 10751, tvId: 10751, aliases: ["family-friendly", "for the family"] },
  fantasy: { name: "Fantasy", movieId: 14, tvId: 10765, tvLabel: "Sci-Fi & Fantasy", tvNote: "TMDB combines TV Science Fiction and Fantasy into one genre, so series results may include both.", aliases: ["magical"] },
  history: { name: "History", movieId: 36, tvId: null, tvLabel: "History (not available as TV filter)", tvNote: "TMDB does not expose a distinct TV History genre; TV results are omitted rather than shown without a verified History filter.", aliases: ["historical"] },
  horror: { name: "Horror", movieId: 27, tvId: null, tvLabel: "Horror (not available as TV filter)", tvNote: "TMDB does not expose a distinct TV Horror genre; TV results are omitted rather than shown without a verified Horror filter.", aliases: ["scary", "terrifying", "spooky"] },
  mystery: { name: "Mystery", movieId: 9648, tvId: 9648, aliases: ["mysterious"] },
  romance: { name: "Romance", movieId: 10749, tvId: null, tvLabel: "Romance (not available as TV filter)", tvNote: "TMDB does not expose a distinct TV Romance genre; TV results are omitted rather than shown without a verified Romance filter.", aliases: ["romantic", "love story", "love stories"] },
  "science fiction": { name: "Science fiction", movieId: 878, tvId: 10765, tvLabel: "Sci-Fi & Fantasy", tvNote: "TMDB combines TV Science Fiction and Fantasy into one genre, so series results may include both.", aliases: ["sci-fi", "scifi", "science-fiction"] },
  thriller: { name: "Thriller", movieId: 53, tvId: 9648, tvLabel: "Mystery (closest TV category)", tvNote: "TMDB has no distinct TV Thriller genre; TV results use the broader Mystery category.", aliases: ["suspense", "suspenseful"] },
  war: { name: "War", movieId: 10752, tvId: 10768, tvLabel: "War & Politics", tvNote: "TMDB combines TV War and Politics into one genre.", aliases: ["military"] },
  western: { name: "Western", movieId: 37, tvId: 37, aliases: ["cowboy"] }
});

const LANGUAGES = Object.freeze({
  english: "en", korean: "ko", japanese: "ja", french: "fr", spanish: "es",
  hindi: "hi", chinese: "zh", mandarin: "zh", german: "de", italian: "it",
  portuguese: "pt", thai: "th", arabic: "ar", turkish: "tr", tamil: "ta",
  telugu: "te", yoruba: "yo"
});


const COUNTRY_HINTS = Object.freeze([
  { code: "NG", name: "Nigeria", aliases: ["nigerian", "nigeria", "nollywood"] },
  { code: "GH", name: "Ghana", aliases: ["ghanaian", "ghana"] },
  { code: "GB", name: "United Kingdom", aliases: ["british", "britain", "united kingdom", "uk"] },
  { code: "US", name: "United States", aliases: ["american", "united states", "usa"] },
  { code: "CA", name: "Canada", aliases: ["canadian", "canada"] },
  { code: "AU", name: "Australia", aliases: ["australian", "australia"] },
  { code: "ZA", name: "South Africa", aliases: ["south african", "south africa"] },
  { code: "IN", name: "India", aliases: ["indian", "india"] },
  { code: "KR", name: "South Korea", aliases: ["south korean", "south korea", "korean", "korea"] },
  { code: "JP", name: "Japan", aliases: ["japanese", "japan"] },
  { code: "FR", name: "France", aliases: ["french", "france"] },
  { code: "ES", name: "Spain", aliases: ["spanish", "spain"] },
  { code: "DE", name: "Germany", aliases: ["german", "germany"] },
  { code: "IT", name: "Italy", aliases: ["italian", "italy"] },
  { code: "BR", name: "Brazil", aliases: ["brazilian", "brazil"] },
  { code: "MX", name: "Mexico", aliases: ["mexican", "mexico"] },
  { code: "TR", name: "Turkey", aliases: ["turkish", "turkey"] },
  { code: "TH", name: "Thailand", aliases: ["thai", "thailand"] },
  { code: "PH", name: "Philippines", aliases: ["filipino", "philippines"] },
  { code: "EG", name: "Egypt", aliases: ["egyptian", "egypt"] },
  { code: "SE", name: "Sweden", aliases: ["swedish", "sweden"] },
  { code: "DK", name: "Denmark", aliases: ["danish", "denmark"] },
  { code: "NO", name: "Norway", aliases: ["norwegian", "norway"] },
  { code: "RU", name: "Russia", aliases: ["russian", "russia"] },
  { code: "IR", name: "Iran", aliases: ["iranian", "iran"] },
  { code: "ID", name: "Indonesia", aliases: ["indonesian", "indonesia"] },
  { code: "IE", name: "Ireland", aliases: ["irish", "ireland"] },
  { code: "NZ", name: "New Zealand", aliases: ["new zealand", "new zealander"] },
  { code: "CN", name: "China", aliases: ["chinese", "china"] },
  { code: "HK", name: "Hong Kong", aliases: ["hong kong"] },
  { code: "TW", name: "Taiwan", aliases: ["taiwanese", "taiwan"] },
  { code: "AR", name: "Argentina", aliases: ["argentinian", "argentina"] },
  { code: "CO", name: "Colombia", aliases: ["colombian", "colombia"] },
  { code: "PL", name: "Poland", aliases: ["polish", "poland"] },
  { code: "NL", name: "Netherlands", aliases: ["dutch", "netherlands"] },
  { code: "PT", name: "Portugal", aliases: ["portuguese", "portugal"] },
  { code: "FI", name: "Finland", aliases: ["finnish", "finland"] },
  { code: "IS", name: "Iceland", aliases: ["icelandic", "iceland"] },
  { code: "KE", name: "Kenya", aliases: ["kenyan", "kenya"] },
  { code: "UG", name: "Uganda", aliases: ["ugandan", "uganda"] },
  { code: "TZ", name: "Tanzania", aliases: ["tanzanian", "tanzania"] },
  { code: "ET", name: "Ethiopia", aliases: ["ethiopian", "ethiopia"] },
  { code: "MA", name: "Morocco", aliases: ["moroccan", "morocco"] },
  { code: "SA", name: "Saudi Arabia", aliases: ["saudi arabia", "saudi"] },
  { code: "IL", name: "Israel", aliases: ["israeli", "israel"] },
  { code: "PK", name: "Pakistan", aliases: ["pakistani", "pakistan"] },
  { code: "BD", name: "Bangladesh", aliases: ["bangladeshi", "bangladesh"] },
  { code: "LK", name: "Sri Lanka", aliases: ["sri lankan", "sri lanka"] },
  { code: "MY", name: "Malaysia", aliases: ["malaysian", "malaysia"] },
  { code: "VN", name: "Vietnam", aliases: ["vietnamese", "vietnam"] },
  { code: "SG", name: "Singapore", aliases: ["singaporean", "singapore"] }
]);

const LANGUAGE_COUNTRY_ADJECTIVES = new Set(["korean", "south korean", "japanese", "french", "spanish", "german", "italian", "turkish", "thai", "russian", "chinese", "portuguese", "dutch", "polish", "swedish", "danish", "norwegian"]);

const STREAMING_PROVIDERS = Object.freeze([
  { id: 8, name: "Netflix", aliases: ["netflix"] },
  { id: 9, name: "Prime Video", aliases: ["amazon prime video", "prime video"] },
  { id: 337, name: "Disney+", aliases: ["disney+", "disney plus"] },
  { id: 1899, name: "HBO Max", aliases: ["hbo max"] },
  { id: 15, name: "Hulu", aliases: ["hulu"] },
  { id: 350, name: "Apple TV+", aliases: ["apple tv+", "apple tv plus"] },
  { id: 531, name: "Paramount+", aliases: ["paramount+", "paramount plus"] }
]);

function includesPhrase(text, phrase) {
  return new RegExp("(^|[^a-z0-9])" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i").test(text);
}

function pluralPhrase(phrase) {
  const parts = phrase.split(" ");
  const last = parts.pop() || "";
  let plural;
  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(last)) plural = last.slice(0, -1) + "ies";
  else if (/(s|x|z|ch|sh)$/i.test(last)) plural = last + "es";
  else plural = last + "s";
  return [...parts, plural].join(" ");
}

function findGenre(text) {
  for (const [key, genre] of Object.entries(GENRES)) {
    if ([key, ...genre.aliases].some(alias =>
      includesPhrase(text, alias) || includesPhrase(text, pluralPhrase(alias))
    )) return { key, ...genre };
  }
  return null;
}


function findCountry(text) {
  const explicitlyLanguageBased = /\b(?:language|speaking|spoken)\b/i.test(text) || new RegExp("\\bin\\s+(?:" + [...LANGUAGE_COUNTRY_ADJECTIVES].map(value => value.replace(/[+]/g, "\\+")).join("|") + ")\\b", "i").test(text);
  for (const country of COUNTRY_HINTS) {
    if (country.aliases.some(alias => {
      if (explicitlyLanguageBased && LANGUAGE_COUNTRY_ADJECTIVES.has(alias) &&
          !includesPhrase(text, country.name.toLowerCase())) return false;
      return includesPhrase(text, alias);
    })) return country;
  }
  return null;
}


function findProviderRegion(text) {
  if (/\bin\s+(?:the\s+)?(?:us|u\.s\.a\.?)\b/i.test(text)) {
    return COUNTRY_HINTS.find(country => country.code === "US") || { code: "US", name: "United States", aliases: ["us", "usa", "united states"] };
  }
  for (const country of COUNTRY_HINTS) {
    for (const alias of country.aliases) {
      if (LANGUAGE_COUNTRY_ADJECTIVES.has(alias) && !includesPhrase(text, country.name.toLowerCase())) continue;
      const escaped = alias.replace(/[+]/g, "\\+");
      const regionPhrase = new RegExp("\\b(?:available|streaming|watchable)\\s+in\\s+(?:the\\s+)?" + escaped + "\\b|\\bin\\s+(?:the\\s+)?" + escaped + "\\b", "i");
      if (regionPhrase.test(text)) return country;
    }
  }
  return null;
}

function removeProviderRegionPhrase(text, country) {
  let cleaned = String(text || "");
  const aliases = [...(country?.aliases || [])];
  if (country?.code === "US") aliases.push("us");
  for (const alias of aliases.sort((a, b) => b.length - a.length)) {
    const escaped = alias.replace(/[+]/g, "\\+");
    cleaned = cleaned.replace(new RegExp("\\b(?:available|streaming|watchable)\\s+in\\s+(?:the\\s+)?" + escaped + "\\b", "gi"), " ");
    cleaned = cleaned.replace(new RegExp("\\bin\\s+(?:the\\s+)?" + escaped + "\\b", "gi"), " ");
  }
  return cleaned.replace(/[\s,]+/g, " ").trim();
}


function buildProviderTitleQuery(text, provider, providerRegion) {
  let cleaned = providerRegion ? removeProviderRegionPhrase(text, providerRegion) : String(text || "");
  for (const alias of [...(provider?.aliases || [])].sort((a, b) => b.length - a.length)) {
    const escaped = alias.replace(/[+]/g, "\\+");
    cleaned = cleaned.replace(new RegExp("\\b(?:available|streaming|watchable)\\s+on\\s+" + escaped + "\\b", "gi"), " ");
    cleaned = cleaned.replace(new RegExp("\\bon\\s+" + escaped + "\\b", "gi"), " ");
  }
  cleaned = cleaned.replace(/^\s*(?:where\s+can\s+i\s+watch|where\s+to\s+watch)\s+/i, "");
  return cleaned.replace(/[\s,]+/g, " ").trim();
}

function findStreamingProvider(text) {
  for (const provider of STREAMING_PROVIDERS) {
    if (provider.aliases.some(alias => includesPhrase(text, alias))) return provider;
  }
  return null;
}

function isProviderCollectionQuery(text, provider) {
  let cleaned = String(text || "").toLowerCase();
  for (const alias of [...(provider?.aliases || [])].sort((a, b) => b.length - a.length)) {
    const escaped = alias.replace(/[+]/g, "\\+");
    cleaned = cleaned.replace(new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)", "gi"), " ");
  }
  cleaned = cleaned.replace(/\b(?:available|streaming|watch|watching|on|from|find|search|me|some|all|the|best|top|movie|movies|film|films|tv|series|show|shows|title|titles|please|something|anything|where|can|i)\b/gi, " ");
  return !cleaned.replace(/[\s,]+/g, " ").trim();
}

function parseDecade(text) {
  const match = text.match(/\b(?:in|from|during|released in|made in)\s+(?:the\s+)?(19\d0s|20\d0s|['’]?\d0s)\b/i)
    || text.match(/\b(19\d0s|20\d0s|['’]?\d0s)\s+(?:movies?|films?|series|shows?)\b/i)
    || text.match(/\b(?:the\s+)?(19\d0s|20\d0s|['’]?\d0s)\b/i);
  if (!match) return null;
  const raw = match[1].replace(/[’']/g, "");
  if (/^(?:19|20)\d0s$/.test(raw)) return Number(raw.slice(0, 4));
  const short = Number(raw.slice(0, -1));
  if (!Number.isFinite(short) || short < 0 || short > 90 || short % 10 !== 0) return null;
  return short <= 20 ? 2000 + short : 1900 + short;
}

function parseRuntime(text) {
  const hours = text.match(/(?:under|below|less than|no more than|within|at most)\s+(\d+(?:\.\d+)?)\s*hours?/i);
  if (hours) return Math.max(1, Math.round(Number(hours[1]) * 60));
  const minutes = text.match(/(?:under|below|less than|no more than|within|at most|max(?:imum)?(?:\s+of)?|up to)\s+(\d+)\s*(?:min|mins|minutes?)\b/i);
  if (minutes) return Math.max(1, Number(minutes[1]));
  const compact = text.match(/(?:under|below|less than|no more than|within|at most)\s+(\d+)m\b/i);
  return compact ? Math.max(1, Number(compact[1])) : null;
}

export function parseIntent(input = "") {
  const query = String(input || "").trim().replace(/\s+/g, " ");
  const text = query.toLowerCase();
  const mediaTypeText = text.replace(/\bapple\s+tv(?:\+| plus)?\b/gi, " ");
  const intent = {
    query,
    mediaType: "all",
    anime: false,
    genre: null,
    runtimeMax: parseRuntime(text),
    year: null,
    decade: null,
    country: null,
    countryName: null,
    provider: null,
    providerRegion: null,
    providerOnly: false,
    titleQuery: null,
    language: null,
    unsupported: [],
    constraints: []
  };

  const mentionsMovie = /\b(movie|movies|film|films|feature film)\b/i.test(mediaTypeText);
  if (/\b(anime|anim[eé])\b/i.test(text)) {
    intent.anime = true;
    intent.mediaType = mentionsMovie ? "movie" : "tv";
    intent.language = "ja";
    intent.genre = { key: "animation", ...GENRES.animation };
    intent.constraints.push(mentionsMovie ? "Anime movies (Japanese-language animation)" : "Anime (Japanese-language animated series)");
  } else if (mentionsMovie) {
    intent.mediaType = "movie";
    intent.constraints.push("Movies");
  } else if (/\b(tv|series|show|shows|drama series|episode|episodes)\b/i.test(mediaTypeText)) {
    intent.mediaType = "tv";
    intent.constraints.push("TV series");
  }

  if (!intent.genre) {
    const genre = findGenre(text);
    if (genre) {
      intent.genre = genre;
      intent.constraints.push(intent.mediaType === "tv" && genre.tvLabel ? genre.tvLabel : genre.name);
      if (intent.mediaType !== "movie" && genre.tvNote) {
        intent.unsupported.push("Catalogue limitation: " + genre.tvNote);
      }
    }
  }

  if (intent.runtimeMax) {
    const runtimeConstraint = intent.mediaType === "tv"
      ? "Up to " + intent.runtimeMax + " min per episode"
      : intent.mediaType === "all"
        ? "Movies up to " + intent.runtimeMax + " min; TV episodes up to " + intent.runtimeMax + " min"
        : "Up to " + intent.runtimeMax + " min";
    intent.constraints.push(runtimeConstraint);
  }

  const decade = parseDecade(text);
  if (decade != null) {
    intent.decade = decade;
    intent.constraints.push(String(decade) + "s");
  }

  const yearMatch = text.match(/\b(?:in|from|released in|made in|during)\s+(19\d{2}|20\d{2})\b/i)
    || text.match(/\b(19\d{2}|20\d{2})\s+(?:movie|film|series|show)\b/i);
  if (yearMatch) {
    intent.year = Number(yearMatch[1]);
    intent.constraints.push(String(intent.year));
  }

  const provider = findStreamingProvider(text);
  const providerRegion = provider ? findProviderRegion(text) : null;
  const countryText = providerRegion ? removeProviderRegionPhrase(text, providerRegion) : text;
  const country = findCountry(countryText);
  if (country) {
    intent.country = country.code;
    intent.countryName = country.name;
    intent.constraints.push("Origin: " + country.name);
  }

  if (provider) {
    intent.provider = { id: provider.id, name: provider.name };
    intent.providerRegion = providerRegion?.code || null;
    const providerQueryText = providerRegion ? removeProviderRegionPhrase(text, providerRegion) : text;
    intent.providerOnly = isProviderCollectionQuery(providerQueryText, provider);
    const providerFilterable = Boolean(
      intent.providerOnly || intent.genre || intent.runtimeMax ||
      intent.year || intent.decade || intent.country || intent.language || intent.anime
    );
    if (providerFilterable) {
      intent.constraints.push("Available on " + provider.name);
      intent.unsupported.push("Streaming availability is region-specific and depends on TMDB provider data.");
    } else {
      intent.titleQuery = buildProviderTitleQuery(text, provider, providerRegion) || null;
      intent.unsupported.push("This looks like a specific-title search; provider availability is not verified by text search.");
    }
  }

  for (const [name, code] of Object.entries(LANGUAGES)) {
    if (includesPhrase(text, name)) {
      intent.language = code;
      intent.constraints.push(name[0].toUpperCase() + name.slice(1));
      break;
    }
  }

  const unsupportedRules = [
    [/\b(dubbed|dubs|subbed|subtitles|subtitle|dub)\b/i, "Dub/subtitle availability is not reliably represented in catalogue metadata."],
    [/\b(less violent|no violence|low violence|dark|mind[- ]?bending|plot twist|based on a true story|thoughtful|emotional|escapist|relaxing|wholesome|fast[- ]?paced|late[- ]night|tonight)\b/i, "That mood or theme is not a dependable structured catalogue filter yet."],
    [/\b(short|long|quick|brief)\s+(episode|episodes|movie|film|series)\b/i, "Please give a runtime limit in minutes or hours; vague length words cannot be filtered reliably."],
    [/\b(crunchyroll|where can i watch)\b/i, "Streaming availability varies by region; this service or title-specific lookup is not supported as a structured filter yet."]
  ];
  for (const [pattern, message] of unsupportedRules) {
    if (pattern.test(text)) intent.unsupported.push(message);
  }

  intent.genreIds = intent.genre
    ? { movie: intent.genre.movieId, tv: intent.genre.tvId }
    : null;
  intent.constraints = [...new Set(intent.constraints)];
  intent.unsupported = [...new Set(intent.unsupported)];
  return intent;
}

export function intentHasFilters(intent = {}) {
  const explicitFilters = Boolean(intent.genre || intent.runtimeMax || intent.year || intent.decade || intent.country || intent.language || intent.anime);
  return Boolean(explicitFilters || (intent.provider ? intent.providerOnly : intent.mediaType !== "all"));
}

export function describeIntent(intent = {}) {
  return [
    ...(intent.constraints || []),
    ...(intent.unsupported || []).map(() => "Needs a more specific check")
  ];
}
