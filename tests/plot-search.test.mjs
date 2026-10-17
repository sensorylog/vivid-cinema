import test from "node:test";
import assert from "node:assert/strict";
import { buildPlotKeywordQueries, extractPlotClues, getPlotConceptPhrases, isPlotDescriptionQuery, scorePlotCandidate, scorePlotCandidates } from "../scripts/plot-search.js";
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


test("explicit clue phrases improve remembered-plot ranking when wording differs from synopsis text", () => {
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
  assert.match(source, /scorePlotCandidates\(intent\.query \|\| "", uniqueByKey\(candidates\), plotClues\)/);
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


test("local concept expansion recognises common plot devices without a hosted model", () => {
  assert.ok(getPlotConceptPhrases("A woman keeps reliving the same day").includes("time loop"));
  assert.ok(getPlotConceptPhrases("A man uses a magic remote to stop time").includes("control time"));
  assert.ok(getPlotConceptPhrases("Two people swap bodies overnight").includes("body swap"));
});

test("Vivid Recall keeps local plot matching and adds isolated Gemini chat with safe fallback", () => {
  const html = readFileSync(new URL("../for-you.html", import.meta.url), "utf8");
  const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../scripts/config.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const csp = readFileSync(new URL("../firebase.json", import.meta.url), "utf8");
  const ai = readFileSync(new URL("../scripts/firebase-ai.js", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../scripts/vivid-recall-chat.js", import.meta.url), "utf8");
  assert.match(html, /YOUR STORY, FOUND/);
  assert.match(html, /Describe the plot, a scene, a character/);
  assert.match(html, /id="recall-chat-form"/);
  assert.match(html, /scripts\/vivid-recall-chat\.js/);
  assert.match(recommendations, /extractPlotClues\(query, 12\)/);
  assert.match(recommendations, /Gemini is unavailable right now; local clue extraction is still active/);
  assert.doesNotMatch(recommendations, /plotAiFallbackUrl|AIRFORCE|aiResult|fetch\(aiEndpoint/i);
  assert.doesNotMatch(config, /airforceApiKey|AIRFORCE_API_KEY/i);
  assert.doesNotMatch(csp, /api\.airforce/i);
  assert.match(ai, /useLimitedUseAppCheckTokens:\s*true/);
  assert.match(ai, /firebasevertexai\.googleapis\.com|GoogleAIBackend/);
  assert.match(chat, /fallbackToLocalSearch\(version\)/);
  assert.match(chat, /Gemini connection failed/);
  assert.ok(chat.includes(String.raw`/\b401\b/`), "HTTP 401 detection must use word boundaries");
  assert.ok(ai.includes(String.raw`].join("\n");`), "Gemini prompt must use real line breaks");
  assert.ok(!ai.includes(String.raw`].join("\\n");`), "Gemini prompt must not contain literal backslash-n separators");
  assert.match(worker, /\.\/scripts\/vivid-recall-chat\.js/);
  assert.match(worker, /\.\/scripts\/firebase-ai\.js/);
  assert.doesNotMatch(worker, /vivid-recall-chat[^"]*\.html/);
  assert.doesNotMatch(html, /Airforce/i);
});
test("detects plot recollections phrased without explicit movie-memory cues", () => {
  assert.equal(isPlotDescriptionQuery("A girl gets lost in a forest and finds a secret world where time moves backwards"), true);
  assert.equal(isPlotDescriptionQuery("A family moves into a house and discovers the walls can show the future"), true);
  assert.equal(isPlotDescriptionQuery("best Korean thriller series with plot twists"), false);
});


test("extracts deterministic plot clues and expands varied story-device wording", () => {
  const clues = extractPlotClues("A woman keeps waking up and reliving the same day after finding a strange remote");
  assert.ok(clues.includes("time loop"));
  assert.ok(clues.includes("same day"));
  assert.ok(clues.length > 0);
  assert.ok(getPlotConceptPhrases("A man freezes time with a remote").includes("magic remote"));
  assert.ok(getPlotConceptPhrases("A family gets trapped inside a video game").includes("trapped in game"));
  assert.ok(getPlotConceptPhrases("Someone predicts what will happen tomorrow").includes("predicts future"));
});

test("multiple independent clue matches outrank a single generic overlap", () => {
  const ranked = scorePlotCandidates("A woman relives the same day and discovers a magic remote", [
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man relives the same day repeatedly." },
    { id: 2, media_type: "movie", title: "Click", overview: "An architect discovers a magic remote that controls time and changes his life." },
    { id: 3, media_type: "movie", title: "A Day", overview: "A woman has a difficult day." }
  ]);
  assert.equal(ranked[0].title, "Click");
  assert.ok(ranked.find(item => item.title === "Click").plotScore > (ranked.find(item => item.title === "Groundhog Day")?.plotScore || 0));
});

test("live remembered-plot flow uses deterministic clues and never calls Gemini", () => {
  const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const forYou = readFileSync(new URL("../scripts/for-you.js", import.meta.url), "utf8");
  assert.match(recommendations, /const localClues = extractPlotClues\(query, 12\)/);
  assert.match(recommendations, /vivid:plot-search-status/);
  assert.doesNotMatch(recommendations, /gemini-plot-search|findSemanticPlotMatches|vivid:gemini-plot-search-status/i);
  assert.doesNotMatch(forYou, /Gemini interprets|vivid:gemini-plot-search-status/i);
});


test("matches equivalent magic/magical wording and ranks the distinctive object above a generic time-loop match", () => {
  const ranked = scorePlotCandidates("A woman relives the same day and discovers a magic remote", [
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man relives the same day repeatedly." },
    { id: 2, media_type: "movie", title: "Click", overview: "An architect discovers a magical universal remote that lets him control time and changes his life." }
  ]);
  assert.equal(ranked[0].title, "Click");
  assert.ok(ranked[0].plotScore > ranked[1].plotScore);
});

test("weak or sparse Recall results trigger a wider but still constrained catalogue fallback", () => {
  const source = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(source, /if \(scored\.length < 3 \|\| Number\(scored\[0\]\?\.plotScore \|\| 0\) < 12\)/);
  assert.match(source, /for \(const page of \[1, 2, 3\]\)/);
});


test("Vivid Recall expands everyday wording into catalogue concepts", () => {
  assert.ok(getPlotConceptPhrases("A guy turns invisible and nobody can see him").includes("invisibility"));
  assert.ok(getPlotConceptPhrases("A kid gets stuck inside a video game").includes("trapped in game"));
  assert.ok(getPlotConceptPhrases("Someone goes back in time to change the future").includes("time travel"));
  assert.ok(getPlotConceptPhrases("A sentient robot becomes human").includes("artificial intelligence"));
  assert.ok(getPlotConceptPhrases("A woman wakes up as someone else").includes("body swap"));
});

test("simple everyday nouns can match common catalogue wording", () => {
  const score = scorePlotCandidate("A kid finds a magic machine", {
    title: "The Strange Machine",
    overview: "A child discovers an enchanted device that changes everything."
  });
  assert.ok(score > 0);
});

test("Recall searches a wider bounded set of catalogue pages when first results are weak", () => {
  const source = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(source, /for \(const page of \[1, 2, 3\]\)/);
});


test("Recall understands plain-language simulation, ghost, and second-chance descriptions", () => {
  assert.ok(getPlotConceptPhrases("A guy discovers his whole world is a simulation").includes("simulation"));
  assert.ok(getPlotConceptPhrases("A child talks to dead people").includes("talks to the dead"));
  assert.ok(getPlotConceptPhrases("A woman gets a second chance at life").includes("second chance at life"));
  assert.ok(getPlotConceptPhrases("A man receives messages from his future self").includes("message from the future"));
});

test("Recall ranks corroborated plot evidence above generic overlap across a small benchmark", () => {
  const fixtures = [
    {
      query: "A woman relives the same day and finds a magic remote",
      expected: "Click",
      candidates: [
        { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man relives the same day over and over." },
        { id: 2, media_type: "movie", title: "Click", overview: "An architect discovers a magical universal remote that lets him control time." }
      ]
    },
    {
      query: "A kid talks to dead people",
      expected: "The Sixth Sense",
      candidates: [
        { id: 3, media_type: "movie", title: "The Sixth Sense", overview: "A boy communicates with spirits and sees dead people." },
        { id: 4, media_type: "movie", title: "The Parent Trap", overview: "Two children meet at camp and discover they are twins." }
      ]
    },
    {
      query: "A guy discovers his whole world is a simulation",
      expected: "The Matrix",
      candidates: [
        { id: 5, media_type: "movie", title: "The Matrix", overview: "A hacker discovers reality is a simulated world controlled by machines." },
        { id: 6, media_type: "movie", title: "The Truman Show", overview: "A man lives in a constructed television world without knowing it." }
      ]
    }
  ];
  for (const fixture of fixtures) {
    const ranked = scorePlotCandidates(fixture.query, fixture.candidates);
    assert.equal(ranked[0]?.title, fixture.expected, fixture.query);
  }
});

