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

async function findAniListMatch(title) {
  const body = {
    query: "query($search:String!){Media(search:$search,type:ANIME){id idMal synonyms title{romaji english native}}}",
    variables: { search: title }
  };
  const data = await fetchJson(ANILIST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const media = data?.data?.Media;
  if (!media?.id || titleScore(title, anilistTitles(media)) < 0.72) return null;
  return { aniListId: String(media.id), malId: String(media.idMal || "") };
}

async function findJikanMatch(title) {
  const url = new URL(JIKAN_URL);
  url.searchParams.set("q", title);
  url.searchParams.set("limit", "10");
  url.searchParams.set("sfw", "true");
  const data = await fetchJson(url.href);
  const candidates = Array.isArray(data?.data) ? data.data : [];
  candidates.sort((a, b) => titleScore(title, jikanTitles(b)) - titleScore(title, jikanTitles(a)));
  const best = candidates[0];
  if (!best?.mal_id || titleScore(title, jikanTitles(best)) < 0.72) return null;
  return { aniListId: "", malId: String(best.mal_id) };
}

export async function resolveAnimeIds(title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { aniListId: "", malId: "" };

  // Resolve both catalogs independently: AniList provides the VidPlus ID, while
  // Jikan provides a useful MAL fallback even when AniList is throttled.
  const [aniList, jikan] = await Promise.all([
    findAniListMatch(cleanTitle),
    findJikanMatch(cleanTitle)
  ]);
  return {
    aniListId: aniList?.aniListId || "",
    malId: aniList?.malId || jikan?.malId || ""
  };
}
