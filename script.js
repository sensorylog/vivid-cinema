import { tmdbApi } from "./scripts/tmdb.js";
import { getHomeSections, getHomeSectionPage, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, getPersonUrl, normalizeResults } from "./scripts/media.js";
import { getLocalLibrary } from "./scripts/library.js";
import { getContinueWatching, getPlaybackProgress, getPersonalRecommendations, getBecauseYouLiked, getTonightPick, dismissTonightPick, formatProgress } from "./scripts/recommendations.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";
import { buildWatchUrl } from "./scripts/routes.js";
import { checkForReleaseAlerts, deliverReleaseAlerts, getPendingReleaseAlerts, requestReleaseAlerts, dismissReleaseAlert } from "./scripts/release-alerts.js";
import { startIntelligenceSync, shouldShowColdStart, completeColdStart, dismissColdStart, recordBehavior, getTasteProfile, getTasteStrength } from "./scripts/intelligence.js";
import { searchIntelligently, getRecentSearches, rememberSearch, clearRecentSearches } from "./scripts/search.js";
import { startCinemaReminderLoop } from "./scripts/cinema-reminders.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0,heroMuted=true,heroPlaying=true,heroTimer=null,heroLoadToken=0,searchRequestId=0;

const rails={};
const sectionState={};

const SECTION_RAIL_IDS=Object.freeze({
 trending:"trending-rail",
 nowPlaying:"now-playing-rail",
 popularMovies:"movies-rail",
 topRatedMovies:"top-rated-rail",
 popularTv:"tv-rail",
 topRatedTv:"top-tv-rail",
 airingToday:"airing-rail",
 anime:"anime-rail",
 kdrama:"kdrama-rail",
 upcoming:"upcoming-rail"
});
