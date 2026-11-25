import test from "node:test";
import assert from "node:assert/strict";
import { createAfricanStoriesFunctions } from "../functions/african-stories.js";

class FakeTimestamp {
  constructor(value = Date.now()) { this.value = value; }
  toMillis() { return this.value; }
  static now() { return new FakeTimestamp(); }
  static fromMillis(value) { return new FakeTimestamp(value); }
}

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

class FakeDb {
  constructor() { this.records = new Map(); }
  collection(name) {
    return {
      doc: id => {
        const key = name + "/" + id;
        return {
          get: async () => {
            const value = this.records.get(key);
            return { exists: value !== undefined, data: () => value };
          },
          set: async value => { this.records.set(key, value); },
          update: async value => {
            const current = this.records.get(key);
            if (!current) throw new Error("missing record");
            this.records.set(key, { ...current, ...value });
          }
        };
      }
    };
  }
}

function makeFunctions(db = new FakeDb()) {
  const functions = createAfricanStoriesFunctions({
    db,
    onCall: (_options, handler) => handler,
    HttpsError: FakeHttpsError,
    Timestamp: FakeTimestamp
  });
  return { db, ...functions };
}

const validDraft = {
  title: "The River Remembers",
  originalTitle: "Nsuo Kae",
  workType: "documentary",
  productionCountries: ["Ghana"],
  storyCountries: ["Ghana"],
  originalLanguages: ["Akan"],
  releaseYear: 2024,
  synopsis: "A documentary record for a test fixture.",
  subjects: ["memory"],
  credits: [{ personName: "Ama Example", role: "Director" }],
  versions: [{
    versionId: "original-cut",
    originalAudioLanguages: ["Akan"],
    subtitleLanguages: ["English"],
    runtimeMinutes: 72,
    releaseYear: 2024
  }],
  sourceCitations: [{ label: "Institutional catalogue", url: "https://archive.example.org/item/1" }],
  accessState: "archive_record"
};

test("African Stories draft writes require the dedicated editor claim", async () => {
  const api = makeFunctions();
  await assert.rejects(
    api.saveAfricanWorkDraft({ auth: { uid: "member", token: {} }, data: { workId: "river-film", work: validDraft } }),
    error => error.code === "permission-denied"
  );
});

test("African Stories draft schema preserves canonical edition identity and source provenance", async () => {
  const api = makeFunctions();
  const result = await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: validDraft }
  });
  assert.equal(result.editorialStatus, "draft");
  const stored = api.db.records.get("africanWorkDrafts/river-film");
  assert.equal(stored.versions[0].versionId, "original-cut");
  assert.equal(stored.sourceCitations[0].url, "https://archive.example.org/item/1");
  assert.equal(stored.accessState, "archive_record");
});

test("African Stories draft rejects Vivid playback states from editorial input", async () => {
  const api = makeFunctions();
  await assert.rejects(
    api.saveAfricanWorkDraft({
      auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
      data: { workId: "river-film", work: { ...validDraft, accessState: "stream_on_vivid" } }
    }),
    error => error.code === "invalid-argument"
  );
});

test("African Stories publishing exposes only public catalogue projection fields", async () => {
  const api = makeFunctions();
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: validDraft }
  });
  const result = await api.publishAfricanWork({
    auth: { uid: "publisher-1", token: { africanStoriesPublisher: true } },
    data: { workId: "river-film" }
  });
  assert.equal(result.editorialStatus, "published");
  const published = api.db.records.get("africanWorksPublic/river-film");
  assert.equal(published.title, validDraft.title);
  assert.equal(published.versions[0].versionId, "original-cut");
  assert.equal("playbackUrl" in published, false);
  assert.equal("rightsGrant" in published, false);
});

test("African Stories playback fails closed until trusted territory infrastructure is configured", async () => {
  const api = makeFunctions();
  const previous = process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
  delete process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
  try {
    await assert.rejects(
      api.createAfricanPlaybackSession({
        auth: { uid: "viewer", token: {} },
        data: { workId: "river-film", versionId: "original-cut" },
        rawRequest: { headers: {} }
      }),
      error => error.code === "failed-precondition"
    );
  } finally {
    if (previous === undefined) delete process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
    else process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER = previous;
  }
});


test("approved rights alone cannot launch playback without a provider-specific session adapter", async () => {
  const api = makeFunctions();
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: validDraft }
  });
  await api.publishAfricanWork({
    auth: { uid: "publisher-1", token: { africanStoriesPublisher: true } },
    data: { workId: "river-film" }
  });
  api.db.records.set("africanProviderRegistryPrivate/provider-one", {
    providerId: "provider-one",
    status: "active",
    securityReviewed: true,
    adapterType: "provider_session",
    embedOrigin: "https://player.provider.example"
  });
  const now = Date.now();
  const decision = await api.setAfricanRightsDecision({
    auth: { uid: "rights-admin", token: { africanStoriesRightsAdmin: true } },
    data: {
      workId: "river-film",
      versionId: "original-cut",
      status: "approved",
      evidenceRef: "contract-record-2026-001",
      providerId: "provider-one",
      territories: ["GH"],
      validFromMs: now - 60_000,
      validUntilMs: now + 60 * 60 * 1000
    }
  });
  assert.equal(decision.rightsApproved, true);
  assert.equal(decision.playbackAdapterReady, false);
  const grant = api.db.records.get("africanRightsGrants/river-film__original-cut");
  assert.equal(grant.rightsApproved, true);
  assert.equal("playbackUrl" in grant, false);

  const previous = process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
  process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER = "x-appengine-country";
  try {
    await assert.rejects(
      api.createAfricanPlaybackSession({
        auth: { uid: "viewer", token: {} },
        data: { workId: "river-film", versionId: "original-cut" },
        rawRequest: { headers: { "x-appengine-country": "GH" } }
      }),
      error => error.code === "failed-precondition" && error.message.includes("session adapter")
    );
  } finally {
    if (previous === undefined) delete process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
    else process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER = previous;
  }
});


test("official external viewing links require the explicit watch_officially access state", async () => {
  const api = makeFunctions();
  await assert.rejects(
    api.saveAfricanWorkDraft({
      auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
      data: {
        workId: "river-film",
        work: { ...validDraft, officialExternalUrl: "https://video.example.org/watch/1" }
      }
    }),
    error => error.code === "invalid-argument"
  );
});
