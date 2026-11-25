import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

const WORK_ID = /^[a-z0-9][a-z0-9-]{1,99}$/;
const VERSION_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
const COUNTRY = /^[A-Z]{2}$/;
const PROVIDER_SESSION_ADAPTERS = Object.freeze({});
const WORK_TYPES = new Set(["feature_film","short_film","series","documentary","short_documentary","newsreel","oral_history","educational_film","animation","experimental","archive_footage","other"]);
const PUBLIC_ACCESS_STATES = new Set(["archive_record","access_pending","watch_officially"]);
const PEERTUBE_ALLOWED_HOSTS = new Set(["framatube.org", "peer.tube"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function requireClaim(request, claim, HttpsError) {
  if (!request.auth) fail(HttpsError, "unauthenticated", "Sign-in is required.");
  if (request.auth.token?.[claim] !== true) fail(HttpsError, "permission-denied", "You do not have permission to perform this African Stories action.");
}

function boundedText(value, max, field, HttpsError, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") fail(HttpsError, "invalid-argument", field + " must be text.");
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) fail(HttpsError, "invalid-argument", field + " is missing or too long.");
  return clean;
}

function boundedStringList(value, maxItems, maxLength, field, HttpsError) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(HttpsError, "invalid-argument", field + " must be a bounded list.");
  return [...new Set(value.map(item => boundedText(item, maxLength, field, HttpsError, true)))];
}

function parseHttpsUrl(value, field, HttpsError) {
  let url;
  try { url = new URL(value); } catch { fail(HttpsError, "invalid-argument", field + " must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password) fail(HttpsError, "invalid-argument", field + " must be an HTTPS URL without embedded credentials.");
  return url;
}

function parseProviderUrl(value, field, HttpsError) {
  const url = parseHttpsUrl(value, field, HttpsError);
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    fail(HttpsError, "invalid-argument", field + " must use a public DNS hostname.");
  }
  return url;
}

function playbackSourceRecords(value, accessState, HttpsError) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) fail(HttpsError, "invalid-argument", "playbackSources must be a list of no more than 12 sources.");
  const ids = new Set();
  const rightsBases = new Set(["public_domain","cc0","cc_by","cc_by_sa","written_permission"]);
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(HttpsError, "invalid-argument", "Each playback source must be an object.");
    const sourceId = boundedText(item.sourceId, 80, "playback sourceId", HttpsError, true);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceId) || ids.has(sourceId)) fail(HttpsError, "invalid-argument", "Playback source IDs must be unique URL-safe identifiers.");
    ids.add(sourceId);
    const provider = boundedText(item.provider, 20, "playback provider", HttpsError, true);
    if (!["youtube","vimeo","peertube","archive"].includes(provider)) fail(HttpsError, "invalid-argument", "Unsupported public playback provider.");
    const enabled = item.enabled === true;
    const label = boundedText(item.label, 160, "playback source label", HttpsError);
    const evidenceRef = boundedText(item.evidenceRef, 240, "playback source evidenceRef", HttpsError, enabled);
    const source = { sourceId, provider, label, enabled, evidenceRef };
    if (provider === "youtube") {
      const videoId = boundedText(item.videoId, 11, "YouTube videoId", HttpsError, enabled);
      if (enabled && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) fail(HttpsError, "invalid-argument", "YouTube videoId must be an 11-character video ID.");
      if (enabled && accessState !== "watch_officially") fail(HttpsError, "failed-precondition", "YouTube embeds require the watch_officially editorial state.");
      source.videoId = videoId;
    } else if (provider === "vimeo") {
      const videoId = boundedText(item.videoId, 15, "Vimeo videoId", HttpsError, enabled);
      const vimeoHash = boundedText(item.vimeoHash, 80, "Vimeo privacy hash", HttpsError);
      if (enabled && (!/^[0-9]{6,15}$/.test(videoId) || (vimeoHash && !/^[A-Za-z0-9]{6,80}$/.test(vimeoHash)))) fail(HttpsError, "invalid-argument", "Vimeo video ID or privacy hash is invalid.");
      if (enabled && accessState !== "watch_officially") fail(HttpsError, "failed-precondition", "Vimeo embeds require the watch_officially editorial state.");
      source.videoId = videoId;
      source.vimeoHash = vimeoHash;
    } else if (provider === "peertube") {
      const instanceOrigin = boundedText(item.instanceOrigin, 500, "PeerTube instanceOrigin", HttpsError, enabled);
      const videoUuid = boundedText(item.videoUuid, 36, "PeerTube videoUuid", HttpsError, enabled);
      if (enabled) {
        const origin = parseProviderUrl(instanceOrigin, "PeerTube instanceOrigin", HttpsError);
        if (origin.origin !== origin.href.replace(/\/$/, "") || !PEERTUBE_ALLOWED_HOSTS.has(origin.hostname.toLowerCase()) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoUuid)) {
          fail(HttpsError, "invalid-argument", "PeerTube requires an origin-only HTTPS instance URL and a valid video UUID.");
        }
        if (accessState !== "watch_officially") fail(HttpsError, "failed-precondition", "PeerTube embeds require the watch_officially editorial state.");
      }
      source.instanceOrigin = instanceOrigin;
      source.videoUuid = videoUuid;
    } else {
      const archiveIdentifier = boundedText(item.archiveIdentifier, 120, "archiveIdentifier", HttpsError, enabled);
      const archiveFile = boundedText(item.archiveFile, 240, "archiveFile", HttpsError, enabled);
      const rightsBasis = boundedText(item.rightsBasis, 40, "archive rightsBasis", HttpsError, enabled);
      if (enabled && (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(archiveIdentifier) || archiveIdentifier.includes("..") ||
          !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,239}$/.test(archiveFile) || archiveFile.includes("..") ||
          !rightsBases.has(rightsBasis))) {
        fail(HttpsError, "invalid-argument", "Internet Archive playback requires a valid item/file and an explicit public-domain, Creative Commons or written-permission basis.");
      }
      source.archiveIdentifier = archiveIdentifier;
      source.archiveFile = archiveFile;
      source.rightsBasis = rightsBasis;
    }
    return source;
  });
}

function versionRecords(value, accessState, HttpsError) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) fail(HttpsError, "invalid-argument", "At least one and no more than 30 edition/version records are required.");
  const ids = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(HttpsError, "invalid-argument", "Each version must be an object.");
    const versionId = boundedText(item.versionId, 80, "versionId", HttpsError, true);
    if (!VERSION_ID.test(versionId) || ids.has(versionId)) fail(HttpsError, "invalid-argument", "Version IDs must be unique URL-safe identifiers.");
    ids.add(versionId);
    const runtimeMinutes = item.runtimeMinutes == null ? null : Number(item.runtimeMinutes);
    if (runtimeMinutes !== null && (!Number.isInteger(runtimeMinutes) || runtimeMinutes < 1 || runtimeMinutes > 1000)) fail(HttpsError, "invalid-argument", "Version runtime is invalid.");
    const releaseYear = item.releaseYear == null ? null : Number(item.releaseYear);
    if (releaseYear !== null && (!Number.isInteger(releaseYear) || releaseYear < 1880 || releaseYear > new Date().getUTCFullYear() + 5)) fail(HttpsError, "invalid-argument", "Version release year is invalid.");
    return {
      versionId,
      editionLabel: boundedText(item.editionLabel, 120, "editionLabel", HttpsError),
      originalAudioLanguages: boundedStringList(item.originalAudioLanguages, 20, 80, "originalAudioLanguages", HttpsError),
      subtitleLanguages: boundedStringList(item.subtitleLanguages, 30, 80, "subtitleLanguages", HttpsError),
      dubbedLanguages: boundedStringList(item.dubbedLanguages, 20, 80, "dubbedLanguages", HttpsError),
      runtimeMinutes,
      releaseYear,
      versionNotes: boundedText(item.versionNotes, 1000, "versionNotes", HttpsError),
      playbackSources: playbackSourceRecords(item.playbackSources, accessState, HttpsError)
    };
  });
}

function safePublicProjection(draft, now) {
  return {
    schemaVersion: 1,
    workId: draft.workId,
    title: draft.title,
    originalTitle: draft.originalTitle,
    alternateTitles: draft.alternateTitles,
    workType: draft.workType,
    productionCountries: draft.productionCountries,
    storyCountries: draft.storyCountries,
    originalLanguages: draft.originalLanguages,
    releaseYear: draft.releaseYear,
    synopsis: draft.synopsis,
    subjects: draft.subjects,
    credits: draft.credits,
    versions: draft.versions,
    sourceCitations: draft.sourceCitations,
    accessState: draft.accessState,
    officialExternalUrl: draft.officialExternalUrl,
    publishedAt: now,
    updatedAt: now
  };
}

export function createAfricanStoriesFunctions({ db, onCall, HttpsError, Timestamp, FieldValue }) {
  const region = "us-central1";

  const saveAfricanWorkDraft = onCall({ region, maxInstances: 10, enforceAppCheck: true }, async request => {
    requireClaim(request, "africanStoriesEditor", HttpsError);
    const workId = boundedText(request.data?.workId, 100, "workId", HttpsError, true);
    if (!WORK_ID.test(workId)) fail(HttpsError, "invalid-argument", "workId must be a URL-safe canonical identifier.");
    const input = request.data?.work;
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(HttpsError, "invalid-argument", "A work object is required.");
    const title = boundedText(input.title, 240, "title", HttpsError, true);
    const workType = boundedText(input.workType, 40, "workType", HttpsError, true);
    if (!WORK_TYPES.has(workType)) fail(HttpsError, "invalid-argument", "Unsupported work type.");
    const releaseYear = input.releaseYear == null ? null : Number(input.releaseYear);
    if (releaseYear !== null && (!Number.isInteger(releaseYear) || releaseYear < 1880 || releaseYear > new Date().getUTCFullYear() + 5)) fail(HttpsError, "invalid-argument", "releaseYear is invalid.");
    const accessState = input.accessState || "archive_record";
    if (!PUBLIC_ACCESS_STATES.has(accessState)) fail(HttpsError, "invalid-argument", "Draft accessState must be archive_record, access_pending or watch_officially. Vivid playback states are assigned only by the rights workflow.");
    const officialExternalUrl = boundedText(input.officialExternalUrl, 2000, "officialExternalUrl", HttpsError);
    if (accessState !== "watch_officially" && officialExternalUrl) fail(HttpsError, "invalid-argument", "An official external URL may only be published with the watch_officially access state.");
    if (officialExternalUrl) parseHttpsUrl(officialExternalUrl, "officialExternalUrl", HttpsError);
    const credits = Array.isArray(input.credits) ? input.credits.slice(0, 100).map(item => ({
      personName: boundedText(item?.personName, 160, "credit personName", HttpsError, true),
      role: boundedText(item?.role, 100, "credit role", HttpsError, true),
      creditedAs: boundedText(item?.creditedAs, 160, "creditedAs", HttpsError)
    })) : [];
    if (!Array.isArray(input.credits || [])) fail(HttpsError, "invalid-argument", "credits must be a list.");
    const sourceCitations = Array.isArray(input.sourceCitations) ? input.sourceCitations.slice(0, 50).map(item => {
      const url = boundedText(item?.url, 2000, "source citation URL", HttpsError, true);
      parseHttpsUrl(url, "source citation URL", HttpsError);
      return { label: boundedText(item?.label, 180, "source citation label", HttpsError, true), url };
    }) : [];
    if (!Array.isArray(input.sourceCitations || [])) fail(HttpsError, "invalid-argument", "sourceCitations must be a list.");
    const versions = versionRecords(input.versions, accessState, HttpsError);
    if (accessState === "watch_officially" && !officialExternalUrl && !versions.some(version => version.playbackSources.some(source => source.enabled))) {
      fail(HttpsError, "failed-precondition", "watch_officially requires an official external URL or at least one enabled official playback source.");
    }
    const now = Timestamp.now();
    const ref = db.collection("africanWorkDrafts").doc(workId);
    const existing = await ref.get();
    const draft = {
      schemaVersion: 1,
      workId,
      title,
      originalTitle: boundedText(input.originalTitle, 240, "originalTitle", HttpsError),
      alternateTitles: boundedStringList(input.alternateTitles, 30, 240, "alternateTitles", HttpsError),
      workType,
      productionCountries: boundedStringList(input.productionCountries, 20, 100, "productionCountries", HttpsError),
      storyCountries: boundedStringList(input.storyCountries, 20, 100, "storyCountries", HttpsError),
      originalLanguages: boundedStringList(input.originalLanguages, 20, 80, "originalLanguages", HttpsError),
      releaseYear,
      synopsis: boundedText(input.synopsis, 3000, "synopsis", HttpsError),
      subjects: boundedStringList(input.subjects, 50, 100, "subjects", HttpsError),
      credits,
      versions,
      sourceCitations,
      accessState,
      officialExternalUrl,
      editorialStatus: "draft",
      createdAt: existing.exists ? existing.data().createdAt : now,
      updatedAt: now,
      createdBy: existing.exists ? existing.data().createdBy : request.auth.uid,
      updatedBy: request.auth.uid
    };
    await ref.set(draft);
    return { workId, editorialStatus: "draft", updatedAt: now.toMillis() };
  });

  const publishAfricanWork = onCall({ region, maxInstances: 10, enforceAppCheck: true }, async request => {
    requireClaim(request, "africanStoriesPublisher", HttpsError);
    const workId = boundedText(request.data?.workId, 100, "workId", HttpsError, true);
    if (!WORK_ID.test(workId)) fail(HttpsError, "invalid-argument", "Invalid workId.");
    const ref = db.collection("africanWorkDrafts").doc(workId);
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(HttpsError, "not-found", "African Stories draft was not found.");
    const draft = snapshot.data();
    if (!draft.title || !draft.workType || !Array.isArray(draft.versions) || !draft.versions.length || !Array.isArray(draft.sourceCitations) || !draft.sourceCitations.length) {
      fail(HttpsError, "failed-precondition", "A title, work type, at least one version and source citations are required before publication.");
    }
    if (draft.officialExternalUrl) parseHttpsUrl(draft.officialExternalUrl, "officialExternalUrl", HttpsError);
    const now = Timestamp.now();
    await db.collection("africanWorksPublic").doc(workId).set(safePublicProjection(draft, now));
    await ref.update({ editorialStatus: "published", publishedAt: now, publishedBy: request.auth.uid, updatedAt: now });
    await db.collection("africanAuditEvents").doc(randomUUID()).set({
      action: "work_published", workId, actorUid: request.auth.uid, occurredAt: now
    });
    return { workId, editorialStatus: "published", publishedAt: now.toMillis() };
  });

  const registerAfricanProvider = onCall({ region, maxInstances: 5, enforceAppCheck: true }, async request => {
    requireClaim(request, "africanStoriesProviderAdmin", HttpsError);
    const providerId = boundedText(request.data?.providerId, 80, "providerId", HttpsError, true);
    if (!PROVIDER_ID.test(providerId)) fail(HttpsError, "invalid-argument", "Invalid providerId.");
    const adapterType = request.data?.adapterType;
    if (adapterType !== "provider_session") fail(HttpsError, "invalid-argument", "Providers must use a provider-specific server-issued session adapter.");
    const originUrl = parseProviderUrl(boundedText(request.data?.embedOrigin, 500, "embedOrigin", HttpsError, true), "embedOrigin", HttpsError);
    if (originUrl.origin !== originUrl.href.replace(/\/$/, "")) fail(HttpsError, "invalid-argument", "embedOrigin must be an origin only, without a path or query.");
    const agreementRef = boundedText(request.data?.agreementRef, 160, "agreementRef", HttpsError, true);
    if (request.data?.securityReviewed !== true) fail(HttpsError, "failed-precondition", "Provider security review must be explicitly confirmed.");
    const now = Timestamp.now();
    await db.collection("africanProviderRegistryPrivate").doc(providerId).set({
      providerId, adapterType, embedOrigin: originUrl.origin,
      status: request.data?.status === "active" ? "active" : "inactive",
      adapterReady: typeof PROVIDER_SESSION_ADAPTERS[providerId]?.createSession === "function",
      agreementRef, securityReviewed: true,
      updatedAt: now, updatedBy: request.auth.uid
    });
    await db.collection("africanAuditEvents").doc(randomUUID()).set({
      action: "provider_registry_updated", providerId, actorUid: request.auth.uid, occurredAt: now
    });
    return { providerId, status: request.data?.status === "active" ? "active" : "inactive", adapterReady: typeof PROVIDER_SESSION_ADAPTERS[providerId]?.createSession === "function" };
  });

  const setAfricanRightsDecision = onCall({ region, maxInstances: 5, enforceAppCheck: true }, async request => {
    requireClaim(request, "africanStoriesRightsAdmin", HttpsError);
    const workId = boundedText(request.data?.workId, 100, "workId", HttpsError, true);
    const versionId = boundedText(request.data?.versionId, 80, "versionId", HttpsError, true);
    if (!WORK_ID.test(workId) || !VERSION_ID.test(versionId)) fail(HttpsError, "invalid-argument", "Invalid work or version identifier.");
    const status = request.data?.status;
    if (!["pending","approved","rejected","suspended"].includes(status)) fail(HttpsError, "invalid-argument", "Invalid rights decision.");
    const draft = await db.collection("africanWorkDrafts").doc(workId).get();
    if (!draft.exists || !draft.data().versions.some(version => version.versionId === versionId)) fail(HttpsError, "not-found", "The exact work version does not exist in the editorial catalogue.");
    const now = Timestamp.now();
    const payload = {
      workId, versionId, status, streamOnVivid: false,
      decisionBy: request.auth.uid, decisionAt: now,
      evidenceRef: boundedText(request.data?.evidenceRef, 240, "evidenceRef", HttpsError, status === "approved"),
      updatedAt: now
    };
    if (status === "approved") {
      const providerId = boundedText(request.data?.providerId, 80, "providerId", HttpsError, true);
      if (!PROVIDER_ID.test(providerId)) fail(HttpsError, "invalid-argument", "Invalid providerId.");
      const providerSnapshot = await db.collection("africanProviderRegistryPrivate").doc(providerId).get();
      if (!providerSnapshot.exists || providerSnapshot.data().status !== "active" || providerSnapshot.data().securityReviewed !== true) fail(HttpsError, "failed-precondition", "An active, reviewed provider is required.");
      if (providerSnapshot.data().adapterType !== "provider_session") fail(HttpsError, "failed-precondition", "The provider has no approved server-issued session contract.");
      const territories = boundedStringList(request.data?.territories, 100, 2, "territories", HttpsError);
      if (!territories.length || territories.some(code => !COUNTRY.test(code))) fail(HttpsError, "invalid-argument", "At least one ISO alpha-2 territory is required.");
      const validFromMs = Number(request.data?.validFromMs);
      const validUntilMs = Number(request.data?.validUntilMs);
      if (!Number.isFinite(validFromMs) || !Number.isFinite(validUntilMs) || validUntilMs <= validFromMs || validUntilMs <= Date.now()) fail(HttpsError, "invalid-argument", "A valid future rights window is required.");
      payload.providerId = providerId;
      payload.allowedTerritories = territories;
      payload.validFrom = Timestamp.fromMillis(validFromMs);
      payload.validUntil = Timestamp.fromMillis(validUntilMs);
      payload.deliveryType = "provider_session";
      payload.rightsApproved = true;
      payload.streamOnVivid = false;
    }
    const grantId = workId + "__" + versionId;
    await db.collection("africanRightsGrants").doc(grantId).set(payload);
    await db.collection("africanAuditEvents").doc(randomUUID()).set({
      action: "rights_decision_" + status, workId, versionId, actorUid: request.auth.uid, occurredAt: now
    });
    return { workId, versionId, status, rightsApproved: payload.rightsApproved === true, playbackAdapterReady: Boolean(payload.providerId && typeof PROVIDER_SESSION_ADAPTERS[payload.providerId]?.createSession === "function") };
  });

  const createAfricanPlaybackSession = onCall({ region, maxInstances: 20, enforceAppCheck: true }, async request => {
    if (!request.auth) fail(HttpsError, "unauthenticated", "Sign in is required to request playback.");
    const trustedHeader = process.env.AFRICAN_STORIES_TRUSTED_COUNTRY_HEADER;
    if (!trustedHeader) fail(HttpsError, "failed-precondition", "Territory verification is not configured. African Stories playback is not enabled.");
    const rawTerritory = request.rawRequest?.headers?.[trustedHeader.toLowerCase()];
    const territory = typeof rawTerritory === "string" ? rawTerritory.toUpperCase() : "";
    if (!COUNTRY.test(territory)) fail(HttpsError, "failed-precondition", "A trusted territory could not be verified.");
    const workId = boundedText(request.data?.workId, 100, "workId", HttpsError, true);
    const versionId = boundedText(request.data?.versionId, 80, "versionId", HttpsError, true);
    if (!WORK_ID.test(workId) || !VERSION_ID.test(versionId)) fail(HttpsError, "invalid-argument", "Invalid work or version identifier.");
    const [workSnapshot, grantSnapshot] = await Promise.all([
      db.collection("africanWorksPublic").doc(workId).get(),
      db.collection("africanRightsGrants").doc(workId + "__" + versionId).get()
    ]);
    if (!workSnapshot.exists || !grantSnapshot.exists) fail(HttpsError, "not-found", "No licensed Vivid playback route is available for this work version.");
    const grant = grantSnapshot.data();
    const now = Timestamp.now();
    if (grant.status !== "approved" || grant.rightsApproved !== true || grant.deliveryType !== "provider_session" ||
        !grant.validFrom || !grant.validUntil || grant.validFrom.toMillis() > now.toMillis() || grant.validUntil.toMillis() <= now.toMillis() ||
        !Array.isArray(grant.allowedTerritories) || !grant.allowedTerritories.includes(territory)) {
      fail(HttpsError, "permission-denied", "This exact edition is not cleared for playback in your territory at this time.");
    }
    const versionExists = Array.isArray(workSnapshot.data().versions) && workSnapshot.data().versions.some(version => version.versionId === versionId);
    if (!versionExists) fail(HttpsError, "failed-precondition", "The published catalogue version does not match the rights record.");
    const providerSnapshot = await db.collection("africanProviderRegistryPrivate").doc(grant.providerId).get();
    if (!providerSnapshot.exists || providerSnapshot.data().status !== "active" || providerSnapshot.data().adapterType !== "provider_session") fail(HttpsError, "failed-precondition", "The approved playback provider is unavailable.");
    const adapter = PROVIDER_SESSION_ADAPTERS[grant.providerId];
    if (typeof adapter?.createSession !== "function") fail(HttpsError, "failed-precondition", "This provider has no implemented server-issued session adapter. Playback remains disabled.");
    const recentSessions = await db.collection("africanPlaybackSessions")
      .where("userId", "==", request.auth.uid)
      .where("createdAt", ">", Timestamp.fromMillis(now.toMillis() - 60 * 1000))
      .limit(5)
      .get();
    if (recentSessions.size >= 5) fail(HttpsError, "resource-exhausted", "Playback session request limit reached. Try again shortly.");
    const issued = await adapter.createSession({
      work: workSnapshot.data(), grant, provider: providerSnapshot.data(),
      userId: request.auth.uid, territory, now
    });
    const playback = parseProviderUrl(issued?.url, "provider session URL", HttpsError);
    if (playback.origin !== providerSnapshot.data().embedOrigin) fail(HttpsError, "failed-precondition", "The provider session URL failed exact-origin verification.");
    const expiresAtMs = Number(issued?.expiresAtMs);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.toMillis() || expiresAtMs > now.toMillis() + 5 * 60 * 1000) {
      fail(HttpsError, "failed-precondition", "The provider did not issue a valid short-lived playback session.");
    }
    const sessionId = randomUUID();
    const expiresAt = Timestamp.fromMillis(expiresAtMs);
    await db.collection("africanPlaybackSessions").doc(sessionId).set({
      sessionId, workId, versionId, userId: request.auth.uid, providerId: grant.providerId,
      territory, status: "active", createdAt: now, expiresAt
    });
    return {
      sessionId,
      expiresAt: expiresAt.toMillis(),
      playback: { type: "iframe", url: playback.toString(), origin: playback.origin }
    };
  });

  return {
    saveAfricanWorkDraft,
    publishAfricanWork,
    registerAfricanProvider,
    setAfricanRightsDecision,
    createAfricanPlaybackSession
  };
}
