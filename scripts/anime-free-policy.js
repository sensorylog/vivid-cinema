export const FREE_ANIME_PREVIEWS = Object.freeze([
  { id: "85937", title: "Demon Slayer" },
  { id: "95479", title: "Jujutsu Kaisen" },
  { id: "1429", title: "Attack on Titan" },
  { id: "37854", title: "One Piece" },
  { id: "46260", title: "Naruto" },
  { id: "65930", title: "My Hero Academia" }
]);

export function isFreeAnimePreviewRoute({ id, type, season = 1, episode = 1 } = {}) {
  return type === "tv" &&
    FREE_ANIME_PREVIEWS.some(item => item.id === String(id || "")) &&
    Number(season) === 1 &&
    Number(episode) === 1;
}
