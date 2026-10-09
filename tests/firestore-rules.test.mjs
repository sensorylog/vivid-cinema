import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  assertFails, assertSucceeds, initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc
} from "firebase/firestore";

let env;
const rules = readFileSync("../firestore.rules", "utf8");
const member = (uid, name = "Test Member", verified = true) =>
  env.authenticatedContext(uid, { email_verified: verified, name }).firestore();
const moderator = (uid = "mod-1") =>
  env.authenticatedContext(uid, { email_verified: true, name: "Vivid Moderator", moderator: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-vivid-cinema",
    firestore: { rules }
  });
});

after(async () => {
  await env?.cleanup();
});

test("public readers can read published articles but cannot write them", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "articles", "article-1"), {
      status: "published",
      headline: "A real sourced entertainment story"
    });
  });
  const publicDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(publicDb, "articles", "article-1")));
  await assertFails(setDoc(doc(publicDb, "articles", "article-2"), { status: "published" }));
});

test("only verified members can publish community posts", async () => {
  const data = {
    authorId: "member-1",
    authorName: "Member One",
    body: "A thoughtful post about Ghanaian cinema.",
    topic: "ghana",
    spoiler: false,
    status: "published",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(member("member-1", "Member One"), "communityPosts", "post-1"), data));
  const unverified = member("member-2", "Member Two", false);
  await assertFails(setDoc(doc(unverified, "communityPosts", "post-2"), {
    ...data, authorId: "member-2", authorName: "Member Two"
  }));
  const signedOut = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(signedOut, "communityPosts", "post-3"), data));
});

test("a member cannot edit another member's post", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "communityPosts", "owned-post"), {
      authorId: "owner-1", authorName: "Owner One", body: "Original post text",
      topic: "film", spoiler: false, status: "published",
      createdAt: new Date(), updatedAt: new Date()
    });
  });
  await assertFails(updateDoc(doc(member("intruder", "Intruder"), "communityPosts", "owned-post"), {
    body: "Changed by someone else", updatedAt: serverTimestamp()
  }));
});

test("poll votes are authenticated, in-range and one per user", async () => {
  await assertSucceeds(setDoc(doc(member("poll-author", "Poll Author"), "communityPolls", "poll-1"), {
    authorId: "poll-author", authorName: "Poll Author",
    question: "Which cinema should get more attention?",
    options: ["Ghanaian cinema", "Nollywood", "Wider African cinema"],
    topic: "african-cinema", status: "published",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  const voter = member("voter-1", "Voter One");
  const voteRef = doc(voter, "communityPolls", "poll-1", "votes", "voter-1");
  await assertSucceeds(setDoc(voteRef, { userId: "voter-1", optionIndex: 1, createdAt: serverTimestamp() }));
  await assertFails(setDoc(voteRef, { userId: "voter-1", optionIndex: 0, createdAt: serverTimestamp() }));
  const invalidVoter = member("voter-2", "Voter Two");
  await assertFails(setDoc(doc(invalidVoter, "communityPolls", "poll-1", "votes", "voter-2"), {
    userId: "voter-2", optionIndex: 9, createdAt: serverTimestamp()
  }));
});

test("reports are private to moderators and moderators can hide reported posts", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "communityReports", "report-1"), {
      reporterId: "member-1", targetType: "communityPost", targetId: "moderated-post",
      postId: null, articleId: null, reason: "harassment", status: "open", createdAt: new Date()
    });
    await setDoc(doc(context.firestore(), "communityPosts", "moderated-post"), {
      authorId: "member-1", authorName: "Member One", body: "A post for moderation",
      topic: "general", spoiler: false, status: "published", createdAt: new Date(), updatedAt: new Date()
    });
  });
  await assertFails(getDoc(doc(member("member-3", "Member Three"), "communityReports", "report-1")));
  await assertSucceeds(getDoc(doc(moderator(), "communityReports", "report-1")));
  await assertSucceeds(updateDoc(doc(moderator(), "communityPosts", "moderated-post"), {
    status: "hidden", moderatedAt: serverTimestamp(), moderatedBy: "mod-1"
  }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "communityPosts", "moderated-post")));
});


test("publisher approval and manual article publishing are moderator-only", async () => {
  const source = {
    publisher: "Example Entertainment Desk", domain: "example.com", status: "approved",
    defaultRegion: "global", defaultCategory: "film", feedUrl: "", feedApproved: false,
    imageUsageApproved: false, reviewNotes: "Reviewed ownership, editorial standards and display terms.",
    verifiedBy: "mod-1", verifiedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(moderator(), "newsSources", "example.com"), source));
  await assertFails(setDoc(doc(member("ordinary", "Ordinary Member"), "newsSources", "other.example"), {
    ...source, domain: "other.example", verifiedBy: "ordinary"
  }));

  const publishedAt = new Date(Date.now() - 60_000);
  const article = {
    headline: "A verified entertainment story", publisher: "Example Entertainment Desk", author: "",
    sourceUrl: "https://example.com/story", canonicalUrl: "https://example.com/story", sourceId: "example.com",
    category: "film", region: "global",
    summary: "An original short summary that links readers to the publisher's report.", body: "",
    imageUrl: "", imageAlt: "A verified entertainment story", publishedAt, updatedAt: publishedAt,
    ingestedAt: serverTimestamp(), status: "published", origin: "editorial", featured: false,
    editorialReviewed: true, correction: "", topics: ["film", "global"]
  };
  await assertSucceeds(setDoc(doc(moderator(), "articles", "manual-story"), article));
  await assertFails(setDoc(doc(member("ordinary", "Ordinary Member"), "articles", "forged-story"), article));
  await assertFails(setDoc(doc(moderator(), "articles", "image-without-rights"), {
    ...article, imageUrl: "https://example.com/image.jpg"
  }));
  await assertFails(setDoc(doc(moderator(), "articles", "unapproved-source"), {
    ...article, sourceId: "unapproved.example", publisher: "Unapproved Publisher",
    sourceUrl: "https://unapproved.example/story", canonicalUrl: "https://unapproved.example/story"
  }));
});

test("members cannot write moderator claims or read private account records for other users", async () => {
  await assertFails(setDoc(doc(member("regular", "Regular"), "communityReports", "fake-report"), {
    reporterId: "regular", targetType: "communityPost", targetId: "x",
    postId: null, articleId: null, reason: "spam", status: "open", createdAt: serverTimestamp(),
    moderator: true
  }));
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", "owner-private"), { email: "private@example.test" });
  });
  await assertFails(getDoc(doc(member("other-user", "Other User"), "users", "owner-private")));
});
