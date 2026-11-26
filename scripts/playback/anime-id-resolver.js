const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4/anime";
const REQUEST_TIMEOUT_MS = 6500;

export function normalizeAnimeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(season|part|cour|tv)\s+[0-9ivx]+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(query, candidates = []) {
  const normalizedQuery = normalizeAnimeTitle(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeAnimeTitle(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedCandidate === normalizedQuery) score = Math.max(score, 1);
    else if (normalizedCandidate.startsWith(normalizedQuery + " ") || normalizedQuery.startsWith(normalizedCandidate + " ")) {
      score = Math.max(score, 0.88);
    } else {
      const queryWords = new Set(normalizedQuery.split(" "));
      const candidateWords = new Set(normalizedCandidate.split(" "));
      const overlap = [...queryWords].filter(word => candidateWords.has(word)).length;
      const union = new Set([...queryWords, ...candidateWords]).size;
      score = Math.max(score, union ? overlap / union : 0);
    }
  }
  return score;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: "application/json", ...(options.headers || {}) } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function anilistTitles(media) {
  return [media?.title?.english, media?.title?.romaji, media?.title?.native, ...(Array.isArray(media?.synonyms) ? media.synonyms : [])].filter(Boolean);
}

function jikanTitles(item) {
  const titles = Array.isArray(item?.titles) ? item.titles.map(entry => entry?.title) : [];
  return [item?.title, item?.title_english, item?.title_japanese, ...titles].filter(Boolean);
}

function buildSearchTerms(title, options = {}) {
  const terms = [];
  const seasonTitle = String(options.seasonTitle || "").trim();
  const normalizedSeason = normalizeAnimeTitle(seasonTitle);
  const genericSeason = /^season \d+$/.test(normalizedSeason);
  if (seasonTitle && !genericSeason && normalizedSeason && normalizedSeason !== normalizeAnimeTitle(title)) {
    terms.push(String(title).trim() + " " + seasonTitle);
  }
  terms.push(String(title).trim());
  return [...new Set(terms.filter(Boolean))];
}

function rankCandidate(candidate, terms, titles, yearValue, options = {}) {
  const scores = terms.map(term => titleScore(term, titles));
  const bestScore = Math.max(0, ...scores);
  const seasonTermScore = terms.length > 1 ? scores[0] : 0;
  const candidateYear = Number(yearValue) || 0;
  const targetYear = Number(options.seasonYear) || 0;
  const yearDifference = candidateYear && targetYear ? Math.abs(candidateYear - targetYear) : null;
  const adjustedScore = bestScore - (yearDifference == null ? 0 : Math.min(0.28, yearDifference * 0.055));
  return { candidate, bestScore, seasonTermScore, yearDifference, adjustedScore };
}

function resolveCandidateEpisodeOffset(ranked, options = {}) {
  const fallbackOffset = Math.max(0, Number(options.episodeOffset) || 0);
  const globalEpisode = Math.max(1, Number(options.globalEpisode) || 1);
  const localEpisode = Math.max(1, Number(options.localEpisode) || 1);
  const episodeCount = Math.max(0, Number(ranked.candidate?.episodes) || 0);
  if (ranked.seasonTermScore >= 0.98) return 0;
  if (episodeCount && episodeCount < globalEpisode) {
    // If the catalogue entry cannot contain the global episode, only use it
    // when its season year clearly identifies the requested TMDB season.
    if (ranked.yearDifference === 0) return 0;
    return null;
  }
  return fallbackOffset;
}

async function findAniListMatch(title, options = {}) {
  const terms = buildSearchTerms(title, options);
  const query = "query($search:String!){Page(perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH){id idMal episodes seasonYear synonyms title{romaji english native}}}}";
  const results = await Promise.all(terms.map(async search => {
    const data = await fetchJson(ANILIST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { search } })
    });
    const media = data?.data?.Page?.media || (data?.data?.Media ? [data.data.Media] : []);
    return media.map(item => rankCandidate(item, terms, anilistTitles(item), item?.seasonYear, options));
  }));
  const ranked = results.flat().sort((a, b) =>
    b.adjustedScore - a.adjustedScore ||
    b.seasonTermScore - a.seasonTermScore ||
    (a.yearDifference ?? 999) - (b.yearDifference ?? 999)
  )[0];
  if (!ranked?.candidate?.id || ranked.bestScore < 0.72) return null;
  const episodeOffset = resolveCandidateEpisodeOffset(ranked, options);
  if (episodeOffset == null) return null;
  return {
    aniListId: String(ranked.candidate.id),
    malId: String(ranked.candidate.idMal || ""),
    episodeOffset
  };
}

async function findJikanMatch(title, options = {}) {
  const terms = buildSearchTerms(title, options);
  const results = await Promise.all(terms.map(async search => {
    const url = new URL(JIKAN_URL);
    url.searchParams.set("q", search);
    url.searchParams.set("limit", "10");
    url.searchParams.set("sfw", "true");
    const data = await fetchJson(url.href);
    return (Array.isArray(data?.data) ? data.data : []).map(item =>
      rankCandidate(item, terms, jikanTitles(item), item?.year || item?.aired?.prop?.from?.year, options)
    );
  }));
  const ranked = results.flat().sort((a, b) =>
    b.adjustedScore - a.adjustedScore ||
    b.seasonTermScore - a.seasonTermScore ||
    (a.yearDifference ?? 999) - (b.yearDifference ?? 999)
  )[0];
  if (!ranked?.candidate?.mal_id || ranked.bestScore < 0.72) return null;
  const episodeOffset = resolveCandidateEpisodeOffset(ranked, options);
  if (episodeOffset == null) return null;
  return { malId: String(ranked.candidate.mal_id), episodeOffset };
}

export async function resolveAnimeIds(title, options = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { aniListId: "", malId: "" };

  // Prefer a season-specific catalogue entry when TMDB provides a distinct
  // season title/year. Otherwise retain a continuous episode offset for
  // single-entry anime catalogues that span multiple TMDB seasons.
  const [aniList, jikan] = await Promise.all([
    findAniListMatch(cleanTitle, options),
    findJikanMatch(cleanTitle, options)
  ]);
  const result = {
    aniListId: aniList?.aniListId || "",
    malId: aniList ? aniList.malId : (jikan?.malId || "")
  };
  if (Object.keys(options).length) {
    result.episodeOffset = aniList?.episodeOffset ?? jikan?.episodeOffset ?? Math.max(0, Number(options.episodeOffset) || 0);
  }
  return result;
}
