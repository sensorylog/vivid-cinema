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


test("official YouTube source is validated and published with the exact edition", async () => {
  const api = makeFunctions();
  const work = {
    ...validDraft,
    accessState: "watch_officially",
    versions: [{
      ...validDraft.versions[0],
      playbackSources: [{
        sourceId: "official-youtube",
        provider: "youtube",
        videoId: "M7lc1UVf-VE",
        label: "Official creator upload",
        enabled: true,
        evidenceRef: "creator-channel-verification-001"
      }]
    }]
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work }
  });
  await api.publishAfricanWork({
    auth: { uid: "publisher-1", token: { africanStoriesPublisher: true } },
    data: { workId: "river-film" }
  });
  const published = api.db.records.get("africanWorksPublic/river-film");
  assert.equal(published.versions[0].playbackSources[0].provider, "youtube");
  assert.equal(published.versions[0].playbackSources[0].videoId, "M7lc1UVf-VE");
  assert.equal(published.versions[0].playbackSources[0].enabled, true);
  assert.equal("evidenceRef" in published.versions[0].playbackSources[0], false);
  const draft = api.db.records.get("africanWorkDrafts/river-film");
  assert.equal(draft.versions[0].playbackSources[0].evidenceRef, "creator-channel-verification-001");
});

test("official platform embeds cannot be published without watch_officially and evidence", async () => {
  const api = makeFunctions();
  const youtube = {
    sourceId: "official-youtube", provider: "youtube", videoId: "M7lc1UVf-VE",
    label: "Official upload", enabled: true, evidenceRef: "creator-verification"
  };
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: {
      ...validDraft,
      versions: [{ ...validDraft.versions[0], playbackSources: [youtube] }]
    } }
  }), error => error.code === "failed-precondition");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [{ ...youtube, evidenceRef: "" }] }]
    } }
  }), error => error.code === "invalid-argument");
});

test("Internet Archive playback requires an explicit rights basis and evidence reference", async () => {
  const api = makeFunctions();
  const archiveSource = {
    sourceId: "archive-file", provider: "archive", archiveIdentifier: "ghana-archive-001",
    archiveFile: "feature.mp4", rightsBasis: "public_domain", enabled: true,
    evidenceRef: "rights-review-001", label: "Public archive copy"
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: {
      ...validDraft,
      versions: [{ ...validDraft.versions[0], playbackSources: [archiveSource] }]
    } }
  });
  const saved = api.db.records.get("africanWorkDrafts/river-film");
  assert.equal(saved.versions[0].playbackSources[0].provider, "archive");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "other-film", work: {
      ...validDraft,
      versions: [{ ...validDraft.versions[0], playbackSources: [{ ...archiveSource, rightsBasis: "unknown", evidenceRef: "" }] }]
    } }
  }), error => error.code === "invalid-argument");
});


test("Dailymotion source requires a creator-provided Player ID and official viewing state", async () => {
  const api = makeFunctions();
  const source = {
    sourceId: "official-dailymotion", provider: "dailymotion", videoId: "x84sh87",
    playerId: "x8lr5", label: "Creator's Dailymotion player", enabled: true,
    evidenceRef: "creator-channel-verification-002"
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [source] }]
    } }
  });
  const saved = api.db.records.get("africanWorkDrafts/river-film");
  assert.equal(saved.versions[0].playbackSources[0].playerId, "x8lr5");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "other-film", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [{ ...source, playerId: "" }] }]
    } }
  }), error => error.code === "invalid-argument");
});


test("Rumble source accepts only an official embed ID and watch_officially state", async () => {
  const api = makeFunctions();
  const source = {
    sourceId: "official-rumble", provider: "rumble", embedId: "v5pv5f",
    label: "Creator-provided Rumble embed", enabled: true, evidenceRef: "creator-channel-verification-003"
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "river-film", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [source] }]
    } }
  });
  assert.equal(api.db.records.get("africanWorkDrafts/river-film").versions[0].playbackSources[0].embedId, "v5pv5f");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "other-film", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [{ ...source, embedId: "bad id" }] }]
    } }
  }), error => error.code === "invalid-argument");
});


test("official provider source records are validated and retained on the exact edition", async () => {
  const api = makeFunctions();
  const work = {
    ...validDraft,
    accessState: "watch_officially",
    versions: [{
      ...validDraft.versions[0],
      playbackSources: [
        { sourceId: "official-youtube", provider: "youtube", videoId: "M7lc1UVf-VE", enabled: true, evidenceRef: "creator-check-001" },
        { sourceId: "official-vimeo", provider: "vimeo", videoId: "12345678", vimeoHash: "abc123hash", enabled: true, evidenceRef: "creator-check-002" },
        { sourceId: "official-dailymotion", provider: "dailymotion", videoId: "x84sh87", playerId: "x8lr5", enabled: true, evidenceRef: "creator-check-003" },
        { sourceId: "official-rumble", provider: "rumble", embedId: "v5pv5f", enabled: true, evidenceRef: "creator-check-004" },
        { sourceId: "official-peertube", provider: "peertube", instanceOrigin: "https://peer.tube", videoUuid: "52a10666-3a18-4e73-93da-e8d3c12c305a", enabled: true, evidenceRef: "creator-check-005" }
      ]
    }]
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "multi-provider-work", work }
  });
  await api.publishAfricanWork({
    auth: { uid: "publisher-1", token: { africanStoriesPublisher: true } },
    data: { workId: "multi-provider-work" }
  });
  const published = api.db.records.get("africanWorksPublic/multi-provider-work");
  assert.deepEqual(published.versions[0].playbackSources.map(source => source.provider),
    ["youtube", "vimeo", "dailymotion", "rumble", "peertube"]);
  assert.equal("evidenceRef" in published.versions[0].playbackSources[0], false);
  assert.equal(published.versions[0].playbackSources[2].playerId, "x8lr5");
});

test("archive source records require explicit rights basis and evidence", async () => {
  const api = makeFunctions();
  const work = {
    ...validDraft,
    versions: [{
      ...validDraft.versions[0],
      playbackSources: [{
        sourceId: "archive-public-file", provider: "archive",
        archiveIdentifier: "ghana-archive-item-001", archiveFile: "film.mp4",
        rightsBasis: "public_domain", enabled: true, evidenceRef: "permission-001"
      }]
    }]
  };
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "archive-work", work }
  });
  const saved = api.db.records.get("africanWorkDrafts/archive-work");
  assert.equal(saved.versions[0].playbackSources[0].rightsBasis, "public_domain");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "archive-work-bad", work: {
      ...work,
      versions: [{
        ...work.versions[0],
        playbackSources: [{
          ...work.versions[0].playbackSources[0], rightsBasis: "unknown"
        }]
      }]
    } }
  }), error => error.code === "invalid-argument");
});

test("PeerTube rejects unreviewed instance origins and Dailymotion requires its creator player ID", async () => {
  const api = makeFunctions();
  const baseSource = { sourceId: "peertube-source", provider: "peertube", instanceOrigin: "https://unreviewed.example", videoUuid: "52a10666-3a18-4e73-93da-e8d3c12c305a", enabled: true, evidenceRef: "creator-check" };
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "bad-peertube", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [baseSource] }]
    } }
  }), error => error.code === "invalid-argument");
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "bad-dailymotion", work: {
      ...validDraft, accessState: "watch_officially",
      versions: [{ ...validDraft.versions[0], playbackSources: [{
        sourceId: "dailymotion-source", provider: "dailymotion", videoId: "x84sh87",
        enabled: true, evidenceRef: "creator-check"
      }] }]
    } }
  }), error => error.code === "invalid-argument");
});


test("Creative Commons BY archive records require attribution before publication", async () => {
  const api = makeFunctions();
  const work = {
    ...validDraft,
    versions: [{
      ...validDraft.versions[0],
      playbackSources: [{
        sourceId: "archive-cc-by", provider: "archive",
        archiveIdentifier: "ghana-archive-item-002", archiveFile: "film.mp4",
        rightsBasis: "cc_by", enabled: true, evidenceRef: "archive-rights-002"
      }]
    }]
  };
  await assert.rejects(api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "archive-cc-by-no-credit", work }
  }), error => error.code === "invalid-argument");
  work.versions[0].playbackSources[0].attributionText = "Directed by Ama Example, Ghana Film Archive";
  await api.saveAfricanWorkDraft({
    auth: { uid: "editor-1", token: { africanStoriesEditor: true } },
    data: { workId: "archive-cc-by-with-credit", work }
  });
  const saved = api.db.records.get("africanWorkDrafts/archive-cc-by-with-credit");
  assert.equal(saved.versions[0].playbackSources[0].attributionText, "Directed by Ama Example, Ghana Film Archive");
});
