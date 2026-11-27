import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAndroidPlayerBackAction } from "../scripts/android-navigation.js";

const source = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");

test("player accepts JSON-string provider messages and validates parsed payloads", () => {
  assert.match(source, /typeof payload === "string"/);
  assert.match(source, /payload = JSON\.parse\(payload\)/);
  assert.match(source, /Array\.isArray\(payload\)/);
});

test("known provider origin aliases are recognized without trusting arbitrary origins", () => {
  assert.match(source, /VIDSRC_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /VIDKING_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /VIDPLUS_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /event\.source !== player\.contentWindow/);
});

test("player iframe sends only the origin referrer for provider domain checks without sandboxing embeds", () => {
  assert.match(source, /referrerpolicy="origin"/);
  assert.doesNotMatch(source, /<iframe[^>]*sandbox=/);
});

test("watch page no longer contains the removed Movie Scraper Player 2 integration", () => {
  assert.doesNotMatch(source, /movie-scraper-lovat-three|secondaryPlayerMarkup|vivid-secondary-player|upstream stream extraction has failed/);
});


test("direct-stream diagnostics require an explicit playbackDebug query flag", () => {
  assert.match(source, /route\.params\.get\("playbackDebug"\) === "1"/);
  assert.match(source, /onDiagnostics:\s*sample\s*=>/);
  assert.match(source, /\[Vivid playback diagnostics\]/);
});


test("iframe diagnostics are opt-in and do not log raw provider payloads", () => {
  assert.match(source, /\[Vivid iframe diagnostics\]/);
  assert.match(source, /debugData\.event \|\| debugData\.player_status/);
  assert.match(source, /route\.params\.get\("playbackDebug"\) === "1"/);
  assert.doesNotMatch(source, /console\.info\("\[Vivid iframe diagnostics\]",\s*payload/);
});



test("free anime previews are allowlisted and expose only one in-app player", () => {
  assert.match(source, /isFreeAnimePreviewRoute/);
  assert.match(source, /return source === "vidapi" && hasFallbackId\(\)/);
  assert.match(source, /if \(isAnimePlayback\(\)\) return null/);
  assert.match(source, /button\.hidden = isAnimePlayback\(\) \? source !== "vidapi"/);
  assert.match(source, /if \(isAnimePlayback\(\)\) \$\("vivid-tflix-player"\)\?\.remove\(\)/);
  assert.match(source, /if \(!isAnimePlayback\(\)\) mountSecondaryPlayer/);
  assert.doesNotMatch(source, /data-player-source="aniweeb"/);
});



test("movie and TV playback exposes ten sources while Free Anime is restricted", () => {
  assert.match(source, /const order = \["vidapi", "vidsrc", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"\]/);
  assert.match(source, /if \(source === "vidapi" \|\| source === "vidsrc" \|\| source === "vidfast" \|\| source === "embedapistream" \|\| source === "moviesapi"\) return hasFallbackId\(\)/);
  assert.match(source, /button\.hidden = isAnimePlayback\(\) \? source !== "vidapi"/);
  assert.match(source, /<span class="vivid-server-count">10 sources<\/span>/);
  assert.doesNotMatch(source, /mountPlaybackServerSettings\(serverPanel/);
  for (const provider of ["embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi", "archive", "commons", "loc"]) {
    assert.ok(source.includes(`data-player-source="${provider}"`), `${provider} should have a Player 1 button`);
  }
});



test("movie/TV server picker keeps all providers in a simple scrollable dropdown", async () => {
  assert.match(source, /\["archive", "commons", "loc"\]\.includes\(source\)/);
  assert.match(source, /const toggleServerMenu = \(\) =>/);
  assert.match(source, /positionServerPanel/);
  const styles = await readFile(new URL("../styles/vivid-cleanup.css", import.meta.url), "utf8");
  assert.match(styles, /\.vivid-server-panel\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(styles, /overflow-y:\s*(?:auto|scroll)/);
  assert.match(styles, /touch-action:\s*pan-y/);
});


test("watch artwork renders before optional anime lookup and TV episode metadata", () => {
  const detailsLoad = source.indexOf('details = currentParams.type === "tv" ? await tmdbApi.tvDetails');
  const earlyHydrate = source.indexOf("hydrateWatchDetails(currentParams);", detailsLoad);
  const animeLookup = source.indexOf("const animeIdsPromise = (isAnimePlayback() || isLikelyAnime())", detailsLoad);
  const tvSeason = source.indexOf("details.episode = await tmdbApi.tvSeason", detailsLoad);
  const finalHydrate = source.indexOf("hydrateWatchDetails(currentParams);", earlyHydrate + 1);

  assert.ok(detailsLoad >= 0, "TMDB title details should load");
  assert.ok(earlyHydrate > detailsLoad, "title artwork should render as soon as TMDB details arrive");
  assert.ok(animeLookup > earlyHydrate, "optional anime lookup must not precede initial artwork rendering");
  assert.ok(tvSeason > earlyHydrate, "TV season lookup must not precede initial artwork rendering");
  assert.ok(finalHydrate > tvSeason, "episode-specific details should refresh the initial metadata");
});

test("anime catalog lookup is limited to anime titles and lookup failures do not abort watch rendering", () => {
  assert.match(source, /const animeIdsPromise = \(isAnimePlayback\(\) \|\| isLikelyAnime\(\)\)[\s\S]*?resolveAnimeIds\([\s\S]*?\.catch\(error => \{[\s\S]*?return \{ aniListId: "", malId: "" \};[\s\S]*?\}\)[\s\S]*?: Promise\.resolve\(\{ aniListId: "", malId: "" \}\)/);
});

test("watch page lazy-loads only the selected secondary player module", () => {
  assert.doesNotMatch(source, /^import .*secondary-player\.js/m);
  assert.match(source, /function mountSecondaryPlayer\(params, title, detailsSnapshot = details\)/);
  assert.match(source, /if \(isAnimePlayback\(\)\) \{[\s\S]*?import\("\.\/playback\/anime-secondary-player\.js"\)/);
  assert.match(source, /import\("\.\/playback\/tflix-secondary-player\.js"\)/);
  assert.match(source, /mountSecondaryPlayer\(params, episodeTitle \|\| title\)/);
  assert.match(source, /mountSecondaryPlayer\(currentParams, details\.episode\?\.name \|\| media\.title \|\| media\.name, details\)/);
});

test("direct playback force-saves the latest position before player teardown", () => {
  assert.match(source, /let persistDirectProgress = null/);
  assert.match(source, /persistDirectProgress\?\.\(\);[\s\S]*?stopDirectStream\(directPlayer\)/);
  assert.match(source, /const saveDirectProgress = \(completed = false, force = false\)/);
  assert.match(source, /!completed && !force && now - lastDirectProgressSaveAt < 8000/);
  assert.match(source, /persistDirectProgress = \(\) => saveDirectProgress\(false, true\)/);
});

test("direct playback flushes its final progress when the app is backgrounded or page-hidden", () => {
  assert.match(source, /visibilitychange[\s\S]*?persistDirectProgress\?\.\(\)[\s\S]*?flushPlaybackProgress\(progressKey\(\)\)/);
  assert.match(source, /window\.addEventListener\("pagehide"[\s\S]*?persistDirectProgress\?\.\(\)[\s\S]*?flushPlaybackProgress\(progressKey\(\)\)/);
});


test("TV episode navigation links stay within season and cross to adjacent seasons", () => {
  assert.match(source, /function episodeNavigationMarkup\(params\)/);
  assert.match(source, /const currentSeason = seasons\.find/);
  assert.match(source, /currentEpisode > 1[\s\S]*?episode: currentEpisode - 1/);
  assert.match(source, /currentEpisode < Number\(currentSeason\.episode_count\)[\s\S]*?episode: currentEpisode \+ 1/);
  assert.match(source, /buildWatchUrl\(media\.id, "tv", target\.season, target\.episode\)/);
  assert.match(source, /isAnimePlayback\(\) \? "&anime=1" : ""/);
  assert.match(source, /watch-episode-navigation/);
});

test("TV episode navigation disables boundaries and excludes specials", () => {
  assert.match(source, /Number\(season\?\.season_number\) > 0/);
  assert.match(source, /"Beginning of series"/);
  assert.match(source, /"Season complete"/);
});


test("only the verified VidSrc origin emits Watch Room playback bridge events", () => {
  assert.match(source, /activeSource === "vidsrc" && event\.origin === "https:\/\/vidsrc\.sh"/);
  assert.match(source, /new CustomEvent\("vivid:provider-playback"/);
  assert.match(source, /contentId: String\(currentParams\?\.id/);
  assert.match(source, /VIDSRC_ORIGINS\.has\(event\.origin\)/);
});


test("Player 1 publishes provider identity for the shared Watch Room adapter layer", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");
  assert.match(source, /new CustomEvent\("vivid:player-adapter-selected",\s*\{ detail: \{ playerId: "player1", providerId: source \} \}\)/);
});

test("watch player exposes immersive fullscreen and landscape orientation controls", () => {
  assert.match(source, /id="player-fullscreen"/);
  assert.match(source, /playerDialog\.requestFullscreen\(\)/);
  assert.match(source, /screen\.orientation\?\.lock\?\.\("landscape"\)/);
  assert.match(source, /document\.addEventListener\("fullscreenchange"/);
  assert.match(source, /vivid-player-fullscreen-fallback/);
});

test("Android hardware Back routes through the player dismissal handler", () => {
  assert.match(source, /window\.addEventListener\("vivid:android-back", \(\) =>/);
  assert.match(source, /resolveAndroidPlayerBackAction\(/);
  assert.match(source, /document\.fullscreenElement && playerDialog\?\.contains\(document\.fullscreenElement\)/);
  assert.match(source, /closePlayerWindow\(\)/);
});


test("Android Back exits fullscreen before closing the player", () => {
  assert.equal(resolveAndroidPlayerBackAction({ fullscreen: true, fallbackFullscreen: false }), "exit-fullscreen");
  assert.equal(resolveAndroidPlayerBackAction({ fullscreen: false, fallbackFullscreen: true }), "exit-fullscreen");
  assert.equal(resolveAndroidPlayerBackAction({ fullscreen: false, fallbackFullscreen: false }), "close-player");
  assert.match(source, /window\.addEventListener\("vivid:android-back", \(\) =>/);
  assert.match(source, /resolveAndroidPlayerBackAction\(/);
  assert.match(source, /document\.exitFullscreen\?\.\(\)/);
});

test("player window includes compact title synopsis and cast below the video", () => {
  assert.match(source, /function playerInfoMarkup\(\)/);
  assert.match(source, /details\?\.credits\?\.cast/);
  assert.match(source, /class="vivid-player-info"/);
  assert.match(source, /class="vivid-player-cast-rail"/);
  assert.match(source, /playerInfoMarkup\(\) \+ '<\/section><\/div>'/);
});

test("cinema room player preserves a video aspect ratio and keeps close controls visible", async () => {
  const styles = await readFile(new URL("../styles/vivid-watch-room-cinema.css", import.meta.url), "utf8");
  assert.match(styles, /#player-overlay \.vivid-player-frame[\s\S]*?aspect-ratio:16\/9!important/);
  assert.match(styles, /#player-overlay #player-close\{display:inline-flex!important/);
  assert.match(styles, /#player-overlay \.vivid-player-info/);
  assert.match(styles, /\.vivid-topbar[\s\S]*?display:none!important/);
});


test("VidSrc forwards progress, seek, readiness and explicit play/pause transitions to room sync", () => {
  assert.match(source, /\["play", "playing", "pause", "paused", "seeked", "timeupdate", "progress", "completed", "ended", "ready", "canplay", "loadedmetadata"\]/);
  assert.match(source, /eventType: providerStatus/);
  assert.match(source, /normalizedStatus/);
});


test("Archive Cinema is integrated as a rights-filtered movie fallback in Player 1", async () => {
  assert.match(source, /id="vivid-archive-search"/);
  assert.match(source, /mountArchiveFilmSearch/);
  assert.match(source, /function showArchiveFallback\(\)/);
  assert.match(source, /if \(!nextSource\)/);
  assert.ok(source.includes("showArchiveFallback();"));
  assert.match(source, /if \(archiveRoot\) archiveRoot\.hidden = true/);
  assert.match(source, /currentParams\?\.type !== "movie"/);
  assert.match(source, /activeSource = provider/);
  assert.match(source, /https:\/\/archive\.org\/embed\//);
  const archive = await readFile(new URL("../scripts/playback/archive-film-fallback.js", import.meta.url), "utf8");
  assert.ok(archive.includes('creativecommons\\.org'));
  assert.match(archive, /public-domain/i);
  assert.match(archive, /hasPlayableVideo/);
  assert.doesNotMatch(archive, /openload|streamtape|vidsrc|torrent/i);
});


test("Internet Archive is a selectable movie source, not only an exhausted-server fallback", () => {
  assert.match(source, /if \(\["archive", "commons", "loc"\]\.includes\(source\)\) return !isAnimePlayback\(\) && currentParams\?\.type === "movie"/);
  assert.match(source, /data-player-source="archive"/);
  assert.match(source, /if \(\["archive", "commons", "loc"\]\.includes\(source\)\) \{[\s\S]*?activeSource = source;[\s\S]*?showArchiveFallback\(\);[\s\S]*?return;/);
  assert.match(source, /button\.hidden = isAnimePlayback\(\) \? source !== "vidapi" : !\[[^\]]*"loc"\]\.includes\(source\)/);
});


test("open movie catalogues are selectable sources and never appear for anime", () => {
  assert.match(source, /data-player-source="archive"/);
  assert.match(source, /data-player-source="commons"/);
  assert.match(source, /data-player-source="loc"/);
  assert.match(source, /\["archive", "commons", "loc"\]\.includes\(source\)/);
  assert.match(source, /button\.hidden = isAnimePlayback\(\) \? source !== "vidapi"/);
  assert.match(source, /directPlayer\.src = directUrl/);
});

test("profile changes leave active playback before the new profile loads", async () => { const source = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8"); assert.match(source, /vivid:profile-changed/); assert.match(source, /window\.location\.replace\("home\.html"\)/); });
