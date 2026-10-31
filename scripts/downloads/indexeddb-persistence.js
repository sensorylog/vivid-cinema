const DATABASE_VERSION = 1;
const STORE_NAME = "ownerJobs";

function validateOwner(ownerId) {
  const value = String(ownerId ?? "").trim();
  if (!value || value.length > 128) throw new TypeError("A non-empty owner ID (maximum 128 characters) is required.");
  return value;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

/**
 * IndexedDB metadata persistence scoped to one Vivid account/guest owner.
 * Stores job records only; never store media blobs, signed source URLs or secrets here.
 */
export function createIndexedDBPersistence({
  ownerId,
  indexedDB = globalThis.indexedDB,
  databaseName = "vivid-cinema-downloads"
} = {}) {
  const owner = validateOwner(ownerId);
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw new Error("IndexedDB is unavailable in this environment.");
  }
  const name = String(databaseName || "").trim();
  if (!name || name.length > 128) throw new TypeError("A valid IndexedDB database name is required.");

  let databasePromise;
  function database() {
    if (!databasePromise) {
      const opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "ownerId" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            databasePromise = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error("Unable to open download metadata storage."));
        request.onblocked = () => reject(new Error("Download metadata storage is blocked by another open tab."));
      });
      databasePromise = opening.catch(error => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  }

  return Object.freeze({
    ownerId: owner,
    async load() {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const record = await requestResult(transaction.objectStore(STORE_NAME).get(owner));
      await done;
      return Array.isArray(record?.jobs) ? record.jobs : [];
    },
    async save(jobs) {
      if (!Array.isArray(jobs)) throw new TypeError("Download jobs must be an array.");
      const db = await database();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).put({
        ownerId: owner,
        jobs,
        updatedAt: Date.now()
      });
      await done;
    },
    async close() {
      if (!databasePromise) return;
      const db = await databasePromise;
      db.close();
      databasePromise = null;
    }
  });
}
