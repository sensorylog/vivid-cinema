/**
 * Switch a local-storage key set between authenticated account snapshots.
 *
 * The first account claims the existing anonymous device state. Later account
 * switches preserve the previous owner's state and restore only the target
 * owner's snapshot, preventing one account from inheriting another's memory.
 */
export function switchAccountStorage({ storage, ownerKey, keys = [], uid, clearKeys = [] } = {}) {
  if (!storage || !ownerKey || uid == null || String(uid) === "") {
    return { changed: false, reason: "invalid-arguments" };
  }

  const nextOwner = String(uid);
  try {
    const previousOwner = storage.getItem(ownerKey);
    if (!previousOwner) {
      storage.setItem(ownerKey, nextOwner);
      return { changed: false, claimedAnonymousState: true, owner: nextOwner };
    }
    if (previousOwner === nextOwner) {
      return { changed: false, owner: nextOwner };
    }

    // Snapshot the outgoing account before replacing any active keys.
    for (const key of keys) {
      const current = storage.getItem(key);
      if (current !== null) {
        storage.setItem(key + ":user:" + previousOwner, current);
      }
    }

    // Restore the incoming account, or start clean if it has no local snapshot.
    for (const key of keys) {
      const saved = storage.getItem(key + ":user:" + nextOwner);
      if (saved === null) storage.removeItem(key);
      else storage.setItem(key, saved);
    }
    for (const key of clearKeys) storage.removeItem(key);

    storage.setItem(ownerKey, nextOwner);
    return { changed: true, previousOwner, owner: nextOwner };
  } catch (error) {
    return { changed: false, reason: "storage-error", error };
  }
}
