const PROVIDERS = Object.freeze([
  { id: "vidplus", label: "VidPlus", origin: "https://player.vidplus.to", kind: "anilist", events: false, note: "AniList anime player · sub/dub" },
  { id: "vidlink", label: "VidLink", origin: "https://vidlink.pro", kind: "mal", events: false, note: "MAL anime player · automatic audio fallback" },
  { id: "anixo", label: "AniXo", origin: "https://anixo.buzz", kind: "either", events: true, note: "AniList/MAL · multi-engine failover" },
  { id: "anilink", label: "AniLink", origin: "https://anilink.cc", kind: "anilist", events: true, note: "AniList anime player · progress events" },
  { id: "megaplay", label: "MegaPlay", origin: "https://ani.megaplay.su", kind: "either", events: false, note: "AniList/MAL episode player" },
  { id: "megavid", label: "Megavid", origin: "https://megavid.buzz", kind: "either", events: true, note: "AniList/MAL · progress and error events" },
  { id: "megaflix", label: "MegaFlix", origin: "https://megaflix.buzz", kind: "either", events: false, note: "AniList/MAL episode player" },
  { id: "vidapi", label: "VidAPI", origin: "https://vaplayer.ru", kind: "tmdb", events: false, note: "Existing VIVID player · TMDB movie/TV route" },
  { id: "embedwave", label: "EmbedWave", origin: "https://embedwave.cc", kind: "tmdb", events: false, note: "Existing VIVID player · TMDB movie/TV route" }
]);

const cleanId = value => /^\\d+$/.test(String(value || "").trim()) ? String(value).trim() : "";
const positive = value => Math.max(1, Math.trunc(Number(value) || 1));

export function listAnimePremiumProviders() {
  return PROVIDERS.map(item => ({ ...item }));
}

export function getAnimePremiumProvider(providerId) {
  const item = PROVIDERS.find(provider => provider.id === providerId);
  return item ? { ...item } : null;
}

export function buildAnimePremiumProviderUrl(providerId, {
  mediaType = "tv", tmdbId = "", aniListId = "", malId = "",
  season = 1, episode = 1, track = "sub"
} = {}) {
  const provider = PROVIDERS.find(item => item.id === providerId);
  if (!provider) return "";
  const tmdb = cleanId(tmdbId);
  const ani = cleanId(aniListId);
  const mal = cleanId(malId);
  const ep = positive(episode);
  const s = positive(season);
  const audio = track === "dub" ? "dub" : "sub";
  const isMovie = mediaType === "movie";

  if (provider.kind === "tmdb") {
    if (!tmdb) return "";
    if (providerId === "vidapi") {
      const path = isMovie ? "/embed/movie/" + tmdb : "/embed/tv/" + tmdb + "/" + s + "/" + ep;
      const query = new URLSearchParams({ autoplay: "1", controls: "1", overlay: "1", ds_lang: "en" });
      return provider.origin + path + "?" + query;
    }
    const path = isMovie ? "/embed/movie/" + tmdb : "/embed/tv/" + tmdb + "/" + s + "/" + ep;
    return provider.origin + path + "?autoplay=true";
  }
  if (isMovie) return "";
  if (provider.kind === "anilist" && !ani) return "";
  if (provider.kind === "mal" && !mal) return "";
  if (provider.kind === "either" && !ani && !mal) return "";

  switch (providerId) {
    case "vidplus": {
      const query = new URLSearchParams({ dub: String(audio === "dub"), autoplay: "true", primarycolor: "e50914", secondarycolor: "171717", iconcolor: "ffffff" });
      return provider.origin + "/embed/anime/" + ani + "/" + ep + "?" + query;
    }
    case "vidlink": {
      const query = new URLSearchParams({ fallback: "true", autoplay: "true", primaryColor: "e50914", secondaryColor: "1b1b1b", iconColor: "ffffff" });
      return provider.origin + "/anime/" + mal + "/" + ep + "/" + audio + "?" + query;
    }
    case "anixo": {
      const path = ani ? "/embed/ani/" + ani : "/embed/mal/" + mal;
      return provider.origin + path + "/" + ep + "?track=" + audio + "&autoSkipIntro=1&autoSkipOutro=1";
    }
    case "anilink": {
      const query = new URLSearchParams({ variant: audio, autoplay: "true", primaryColor: "e50914" });
      return provider.origin + "/watch/" + ani + "/" + ep + "?" + query;
    }
    case "megaplay":
      return provider.origin + (ani ? "/ani/" + ani : "/mal/" + mal) + "/" + ep + "/" + audio;
    case "megavid":
      return provider.origin + (ani ? "/ani/" + ani : "/mal/" + mal) + "/" + ep + "/" + audio + "?autoplay=true";
    case "megaflix":
      return provider.origin + "/stream" + (ani ? "/ani/" + ani : "/mal/" + mal) + "/" + ep + "/" + audio;
    default:
      return "";
  }
}

export function resolveAnimePremiumProviderOptions(args = {}) {
  return PROVIDERS.map(provider => ({
    ...provider,
    url: buildAnimePremiumProviderUrl(provider.id, args),
    available: Boolean(buildAnimePremiumProviderUrl(provider.id, args))
  }));
}
