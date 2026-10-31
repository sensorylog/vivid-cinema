import test from "node:test";
import assert from "node:assert/strict";

test("reports an archive outage instead of falsely claiming there are no matching titles", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const { VIVID_DOWNLOADS } = await import("../scripts/downloads/provider-integration.js");
    await assert.rejects(VIVID_DOWNLOADS.getOptions({ title: "Example Film", media_type: "movie" }), /Could not reach either public video archive/);
  } finally { globalThis.fetch = originalFetch; }
});

test("keeps results from a healthy source when the other archive is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("archive.org/advancedsearch.php")) {
      return Response.json({ response: { docs: [] } });
    }
    return new Response("unavailable", { status: 503 });
  };
  try {
    const { VIVID_DOWNLOADS } = await import("../scripts/downloads/provider-integration.js");
    assert.deepEqual(await VIVID_DOWNLOADS.getOptions({ title: "No Archive Result", media_type: "movie" }), []);
  } finally { globalThis.fetch = originalFetch; }
});
