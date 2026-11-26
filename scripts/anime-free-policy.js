// The free Anime lane is a deliberately small sampler. All other anime viewing
// belongs in the membership-protected VIVID Anime Premium experience.
export const FREE_ANIME_SAMPLE_IDS = Object.freeze([
  "85937",   // Demon Slayer: Kimetsu no Yaiba
  "95479",   // Jujutsu Kaisen
  "1429",    // Attack on Titan
  "37854",   // One Piece
  "46260",   // Naruto
  "65930"    // My Hero Academia
]);
export const FREE_ANIME_MAX_SEASON = 1;
export const FREE_ANIME_MAX_EPISODE = 1;

export function isFreeAnimePreview(params = {}) {
  return params.type === "tv" &&
    FREE_ANIME_SAMPLE_IDS.includes(String(params.id || "")) &&
    Number(params.season) === FREE_ANIME_MAX_SEASON &&
    Number(params.episode) === FREE_ANIME_MAX_EPISODE;
}
