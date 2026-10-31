import test from "node:test";
import assert from "node:assert/strict";
import { createIndexedDBPersistence } from "../scripts/downloads/indexeddb-persistence.js";

function createFakeIndexedDB() {
  const databases = new Map();
  return {
    databases,
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let db = databases.get(name);
        const isNew = !db;
        if (!db) {
          const stores = new Map();
          db = {
            objectStoreNames: { contains: key => stores.has(key) },
            createObjectStore(key, { keyPath }) {
              stores.set(key, { keyPath, records: new Map() });
              return {};
            },
            transaction(storeName, mode) {
              const store = stores.get(storeName);
              if (!store) throw new Error("missing store");
              const tx = { error: null, oncomplete: null, onabort: null, onerror: null };
              tx.objectStore = () => ({
                get(key) {
                  const req = {};
                  queueMicrotask(() => {
                    req.result = store.records.get(key);
                    req.onsuccess?.();
                    queueMicrotask(() => tx.oncomplete?.());
                  });
                  return req;
                },
                put(record) {
                  store.records.set(record[store.keyPath], structuredClone(record));
                  queueMicrotask(() => tx.oncomplete?.());
                }
              });
              return tx;
            },
            close() {}
          };
          databases.set(name, db);
        }
        request.result = db;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

test("owner ID is required and bounded", () => {
  assert.throws(() => createIndexedDBPersistence({ ownerId: "" }), /owner ID/);
  assert.throws(() => createIndexedDBPersistence({ ownerId: "x".repeat(129), indexedDB: createFakeIndexedDB() }), /owner ID/);
});

test("metadata round-trips and is isolated by account owner", async () => {
  const indexedDB = createFakeIndexedDB();
  const alice = createIndexedDBPersistence({ ownerId: "alice", indexedDB });
  const bob = createIndexedDBPersistence({ ownerId: "bob", indexedDB });
  const aliceJobs = [{ id: "a1", status: "completed", media: { id: "10", media_type: "movie" } }];
  const bobJobs = [{ id: "b1", status: "paused", media: { id: "20", media_type: "tv" } }];
  await alice.save(aliceJobs);
  await bob.save(bobJobs);
  assert.deepEqual(await alice.load(), aliceJobs);
  assert.deepEqual(await bob.load(), bobJobs);
});

test("a fresh owner starts with an empty job list", async () => {
  const persistence = createIndexedDBPersistence({ ownerId: "guest", indexedDB: createFakeIndexedDB() });
  assert.deepEqual(await persistence.load(), []);
});

test("invalid save payloads are rejected without writing", async () => {
  const persistence = createIndexedDBPersistence({ ownerId: "alice", indexedDB: createFakeIndexedDB() });
  await assert.rejects(persistence.save({ id: "not-an-array" }), /must be an array/);
});
