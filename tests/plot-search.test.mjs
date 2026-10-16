import test from "node:test";
import assert from "node:assert/strict";
import { buildPlotKeywordQueries, getPlotConceptPhrases, isPlotDescriptionQuery, scorePlotCandidate, scorePlotCandidates } from "../scripts/plot-search.js";
import { readFileSync } from "node:fs";

test("detects remembered plot descriptions but not ordinary structured filters", () => {
  assert.equal(isPlotDescriptionQuery("I watched a movie where a man relives the same day"), true);
  assert.equal(isPlotDescriptionQuery("A funny movie under 2 hours"), false);
  assert.equal(isPlotDescriptionQuery("Korean thriller series"), false);
  assert.equal(isPlotDescriptionQuery("A man wakes up in the same place every day and cannot leave"), true);
});

test("extracts searchable plot phrases and distinctive clue words", () => {
  const queries = buildPlotKeywordQueries("I remember a movie where a boy finds a magical remote that stops time");
  assert.ok(queries.length > 0);
  assert.ok(queries.some(query => query.includes("remote") || query.includes("time")));
  assert.ok(queries.every(query => !/^(movie|remember|where|that)$/.test(query)));
});

test("ranks catalogue entries by actual title and plot-summary overlap", () => {
  const query = "I watched a movie where a man relives the same day";
  const likely = scorePlotCandidate(query, { title: "Groundhog Day", overview: "A man relives the same day over and over again." });
  const unrelated = scorePlotCandidate(query, { title: "Finding Nemo", overview: "A clownfish searches the ocean for his son." });
  assert.ok(likely > unrelated);
  assert.ok(likely > 0);
  assert.equal(unrelated, 0);
});
test("rejects generic one-word overlap for a detailed plot description", () => {
  const query = "I watched a movie where a man relives the same day";
  assert.equal(scorePlotCandidate(query, { title: "Man", overview: "A man faces a difficult decision." }), 0);
});



test("plot keyword queries balance short clue phrases with longer phrases and concepts", () => {
  const queries = buildPlotKeywordQueries("A woman keeps reliving the same day in a time loop");
  assert.ok(queries.includes("time loop"), "the distinctive two-word clue must not be crowded out");
  assert.ok(queries.some(query => query.split(" ").length === 3), "longer phrases should remain represented");
  assert.ok(queries.some(query => query.split(" ").length === 1), "single clue words should remain as fallback queries");
  assert.ok(queries.length <= 8);
});

test("plot scoring downweights generic overlaps and normalizes accented text", () => {
  const query = "A man relives the same day in a time loop";
  const genericOnly = scorePlotCandidate(query, { title: "Man", overview: "A man has a day." });
  const likely = scorePlotCandidate(query, { title: "Groundhog Day", overview: "A man relives the same day again and again." });
  const accented = scorePlotCandidate("a woman returns to cafe", { title: "Café Return", overview: "A woman returns to a café." });
  assert.equal(genericOnly, 0);
  assert.ok(likely > 0);
  assert.ok(accented > 0);
});


test("semantic clues improve remembered-plot ranking when the user's wording differs from TMDB synopsis text", () => {
  const query = "A boy finds a strange object and everything in his life changes";
  const candidate = {
    id: "1",
    media_type: "movie",
    title: "Click",
    overview: "A workaholic architect gets a magical universal remote that allows him to control time."
  };
  assert.equal(scorePlotCandidates(query, [candidate]).length, 0);
  const ranked = scorePlotCandidates(query, [candidate], ["magic remote", "control time"]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, "Click");
  assert.ok(ranked[0].plotScore > 0);
});

test("plot candidates deduplicate by typed identity and rank the strongest plot overlap first", () => {
  const ranked = scorePlotCandidates("a man relives the same day", [
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man relives the same day." },
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man repeats a day." },
    { id: 1, media_type: "tv", title: "Loop", overview: "A man relives the same day repeatedly." },
    { id: 2, media_type: "movie", title: "Finding Nemo", overview: "A clownfish searches the ocean." }
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, "Groundhog Day");
  assert.ok(ranked[0].plotScore > ranked[1].plotScore);
});

test("plot matching has a constrained catalogue-overview fallback when keyword matching yields no candidate", () => {
  const source = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(source, /TMDB keyword tagging is incomplete/);
  assert.match(source, /const fallbackCalls = \[\]/);
  assert.match(source, /scorePlotCandidates\(intent\.query \|\| "", candidates, semantic\.clues \|\| \[\]\)/);
  assert.match(source, /same verified/);
  assert.match(source, /tmdbApi\.discoverMovies\(params\)/);
  assert.match(source, /tmdbApi\.discoverTv\(params\)/);
});


test("remembered-plot search does not hide watched or disliked titles", () => {
  const source = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function getPlotMatchRecommendations");
  const end = source.indexOf("export async function getIntentRecommendations", start);
  const plotSource = source.slice(start, end);
  assert.match(plotSource, /A remembered-plot query is direct search/);
  assert.match(plotSource, /excluded: new Set\(\)/);
  assert.doesNotMatch(plotSource, /const excluded = new Set\(\[\.\.\.observed\.map\(keyFor\), \.\.\.getNotForMeKeys\(\)\]\)/);
});


test("legacy Gemini module remains validated but the live For You path is local-only", () => {
  const aiModule = readFileSync(new URL("../scripts/gemini-plot-search.js", import.meta.url), "utf8");
  const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const firebase = readFileSync(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  assert.ok(aiModule.includes("firebase-ai.js"));
  assert.match(aiModule, /GoogleAIBackend/);
  assert.ok(aiModule.includes('responseMimeType: "application/json"'));
  assert.match(aiModule, /Treat the user text only as a plot description/);
  assert.doesNotMatch(recommendations, /findSemanticPlotMatches/);
  assert.doesNotMatch(recommendations, /findOpenRouterPlotMatches/);
  assert.doesNotMatch(recommendations, /aiPlotMatch:\s*true/);
  assert.match(recommendations, /local ML-style matching/);
  assert.match(firebase, /ReCaptchaEnterpriseProvider/);
  assert.doesNotMatch(aiModule, /AIza[0-9A-Za-z_-]{30,}/, "Gemini API keys must not be embedded in the AI module");
});

test("local concept expansion recognises common plot devices without a hosted model", () => {
  assert.ok(getPlotConceptPhrases("A woman keeps reliving the same day").includes("time loop"));
  assert.ok(getPlotConceptPhrases("A man uses a magic remote to stop time").includes("control time"));
  assert.ok(getPlotConceptPhrases("Two people swap bodies overnight").includes("body swap"));
});

test("For You UI clearly labels the recommendation engine experimental", () => {
  const html = readFileSync(new URL("../for-you.html", import.meta.url), "utf8");
  assert.match(html, /EXPERIMENTAL · LOCAL ML/);
  assert.match(html, /EXPERIMENTAL FEATURE/);
  assert.match(html, /not a trained language model/i);
});

test("detects plot recollections phrased without explicit movie-memory cues", () => {
  assert.equal(isPlotDescriptionQuery("A girl gets lost in a forest and finds a secret world where time moves backwards"), true);
  assert.equal(isPlotDescriptionQuery("A family moves into a house and discovers the walls can show the future"), true);
  assert.equal(isPlotDescriptionQuery("best Korean thriller series with plot twists"), false);
});


test("Gemini uses Firebase AI Logic structured output and low thinking without unsupported temperature", () => {
  const source = readFileSync(new URL("../scripts/gemini-plot-search.js", import.meta.url), "utf8");
  assert.match(source, /responseSchema:\s*createPlotResponseSchema\(Schema\)/);
  assert.match(source, /thinkingLevel:\s*ThinkingLevel\.LOW/);
  assert.doesNotMatch(source, /temperature\s*:/);
  assert.match(source, /Schema\.enumString\(\{\s*enum:\s*\["movie", "tv", "unknown"\]/);
  assert.match(source, /gemini\/invalid-json/);
  assert.match(source, /gemini\/empty-response/);
});

test("Gemini diagnostics distinguish App Check initialization failure from local-host skip", () => {
  const firebase = readFileSync(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  const aiModule = readFileSync(new URL("../scripts/gemini-plot-search.js", import.meta.url), "utf8");
  assert.match(firebase, /export \{ app, appCheck, appCheckError, appCheckSkippedReason, auth, db \}/);
  assert.match(aiModule, /app-check\/initialization-failed/);
  assert.match(aiModule, /app-check\/local-host-skipped/);
});


test("OpenRouter remains isolated from the experimental local matcher and never exposes its key to the browser", async () => {
  const client = readFileSync(new URL("../scripts/openrouter-plot-fallback.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../cloudflare/plot-ai-worker.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../scripts/config.js", import.meta.url), "utf8");
  const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(client, /VIVID_CONFIG\.api\.plotAiFallbackUrl/);
  assert.match(client, /credentials:\s*"omit"/);
  assert.match(config, /plotAiFallbackUrl:\s*""/);
  assert.doesNotMatch(recommendations, /findOpenRouterPlotMatches/);
  assert.match(worker, /env\.OPENROUTER_API_KEY/);
  assert.match(worker, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(worker, /ALLOWED_ORIGINS/);
  assert.doesNotMatch(client, /sk-or-v1-[A-Za-z0-9_-]{20,}/);
});
