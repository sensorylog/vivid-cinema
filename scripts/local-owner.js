const OWNER_SNAPSHOT_SUFFIX = ":user:";

export function ownerSnapshotKey(key, owner) {
  return owner === "guest"
    ? String(key) + ":guest"
    : String(key) + OWNER_SNAPSHOT_SUFFIX + String(owner);
}

/**
 * Switch a group of local-first stores between guest and authenticated owners.
 * Existing guest data is claimed on first sign-in; later switches snapshot the
 * outgoing owner and restore only the incoming owner's snapshot.
 */
export function switchLocalOwner({
  storage,
  ownerKey,
  activeKeys,
  uid,
  emptyValues = {},
  snapshotKey = ownerSnapshotKey
}) {
  if (!storage || !ownerKey || !Array.isArray(activeKeys) || !activeKeys.length) {
    return { changed: false };
  }

  const targetOwner = uid ? String(uid) : "guest";
  const currentOwner = storage.getItem(ownerKey);

  // A signed-out first visit is already using the guest namespace implicitly.
  if (!currentOwner && targetOwner === "guest") return { changed: false };

  const readOrEmpty = (key) => {
    const value = storage.getItem(key);
    return value == null ? String(emptyValues[key] ?? "{}") : value;
  };
  const writeSnapshot = (owner) => {
    for (const key of activeKeys) {
      storage.setItem(snapshotKey(key, owner), readOrEmpty(key));
    }
  };

  if (!currentOwner) {
    // Preserve a guest copy while allowing first sign-in to keep its local work.
    writeSnapshot("guest");
    storage.setItem(ownerKey, targetOwner);
    return { changed: true, previousOwner: "guest", owner: targetOwner, firstClaim: true };
  }

  if (currentOwner === targetOwner) return { changed: false, owner: targetOwner };

  writeSnapshot(currentOwner);

  for (const key of activeKeys) {
    const incoming = storage.getItem(snapshotKey(key, targetOwner));
    if (incoming != null) {
      storage.setItem(key, incoming);
    } else if (currentOwner === "guest" && targetOwner !== "guest") {
      // A guest's first account on this device inherits the guest state only
      // when that account has no saved snapshot for this store.
      continue;
    } else {
      storage.setItem(key, String(emptyValues[key] ?? "{}"));
    }
  }

  storage.setItem(ownerKey, targetOwner);
  return { changed: true, previousOwner: currentOwner, owner: targetOwner, firstClaim: false };
}
