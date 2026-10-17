import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/plot-ai-worker.js";

test("Airforce Worker falls through free models in the configured order", async () => {
  const originalFetch = globalThis.fetch;
  const attempted = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    attempted.push(body.model);
    if (attempted.length < 3) return new Response("temporarily unavailable", { status: 503 });
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            clues: ["time loop", "same day"],
            candidates: [{
              title: "Groundhog Day",
              mediaType: "movie",
              confidence: 0.9,
              reason: "The same day repeats."
            }]
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const request = new Request("https://worker.test/api/recall", {
      method: "POST",
      headers: {
        Origin: "https://vivid-cinema.web.app",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "worker-fallback-test"
      },
      body: JSON.stringify({
        description: "A person relives the same day over and over",
        mediaType: "movie"
      })
    });
    const response = await worker.fetch(request, { AIRFORCE_API_KEY: "test-secret" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(attempted, ["glm-4.7-flash", "gpt-oss-20b", "llama-instant"]);
    assert.equal(payload.model, "llama-instant");
    assert.equal(payload.candidates[0].title, "Groundhog Day");
    assert.equal(JSON.stringify(payload).includes("test-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Airforce Worker rejects an unapproved origin without calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("Provider must not be called");
  };
  try {
    const request = new Request("https://worker.test/api/recall", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ description: "A long enough plot description" })
    });
    const response = await worker.fetch(request, { AIRFORCE_API_KEY: "test-secret" });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
