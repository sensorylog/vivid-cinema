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
  const intent = {
    query,
    mediaType: "all",
    anime: false,
    genre: null,
    runtimeMax: parseRuntime(text),
    year: null,
    language: null,
    unsupported: [],
    constraints: []
  };

  const mentionsMovie = /\b(movie|movies|film|films|feature film)\b/i.test(text);
  if (/\b(anime|anim[eé])\b/i.test(text)) {
    intent.anime = true;
    intent.mediaType = mentionsMovie ? "movie" : "tv";
    intent.language = "ja";
    intent.genre = { key: "animation", ...GENRES.animation };
    intent.constraints.push(mentionsMovie ? "Anime movies (Japanese-language animation)" : "Anime (Japanese-language animated series)");
  } else if (mentionsMovie) {
    intent.mediaType = "movie";
    intent.constraints.push("Movies");
  } else if (/\b(tv|series|show|shows|drama series|episode|episodes)\b/i.test(text)) {
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

  const yearMatch = text.match(/\b(?:in|from|released in|made in|during)\s+(19\d{2}|20\d{2})\b/i)
    || text.match(/\b(19\d{2}|20\d{2})\s+(?:movie|film|series|show)\b/i);
  if (yearMatch) {
    intent.year = Number(yearMatch[1]);
    intent.constraints.push(String(intent.year));
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
    [/\b(netflix|prime video|disney\+|hulu|crunchyroll|where can i watch)\b/i, "Streaming availability varies by region and needs a separate provider check."]
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
  return Boolean(intent.mediaType !== "all" || intent.genre || intent.runtimeMax || intent.year || intent.language);
}

export function describeIntent(intent = {}) {
  return [
    ...(intent.constraints || []),
    ...(intent.unsupported || []).map(() => "Needs a more specific check")
  ];
}
