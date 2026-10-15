import test from "node:test";
import assert from "node:assert/strict";
import { switchLocalOwner } from "../scripts/local-owner.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    dump() { return Object.fromEntries(values); }
  };
}

const setup = (storage, uid) => switchLocalOwner({
  storage,
  ownerKey: "owner",
  activeKeys: ["library", "progress"],
  uid,
  emptyValues: { library: "{}", progress: "{}" }
});

test("first sign-in preserves guest state and snapshots a guest copy", () => {
  const storage = memoryStorage({ library: '{"favorites":["guest"]}', progress: '{"movie:1":{"progress":12}}' });
  const result = setup(storage, "user-a");
  assert.equal(result.firstClaim, true);
  assert.equal(storage.getItem("library"), '{"favorites":["guest"]}');
  assert.equal(storage.getItem("library:guest"), '{"favorites":["guest"]}');
  assert.equal(storage.getItem("progress:guest"), '{"movie:1":{"progress":12}}');
});

test("switching accounts snapshots outgoing state and restores only the incoming account", () => {
  const storage = memoryStorage({ owner: "user-a", library: '{"favorites":["A"]}', progress: '{"movie:1":{"progress":40}}' });
  setup(storage, "user-b");
  assert.equal(storage.getItem("library:user:user-a"), '{"favorites":["A"]}');
  assert.equal(storage.getItem("library"), "{}");
  assert.equal(storage.getItem("progress"), "{}");
  storage.setItem("library", '{"favorites":["B"]}');
  setup(storage, "user-a");
  assert.equal(storage.getItem("library"), '{"favorites":["A"]}');
  assert.equal(storage.getItem("progress"), '{"movie:1":{"progress":40}}');
});

test("sign-out restores guest state rather than exposing the last signed-in account", () => {
  const storage = memoryStorage({
    owner: "user-a",
    library: '{"favorites":["A"]}',
    progress: '{"movie:1":{"progress":40}}',
    "library:guest": '{"favorites":["guest"]}',
    "progress:guest": '{"movie:2":{"progress":8}}'
  });
  setup(storage, null);
  assert.equal(storage.getItem("owner"), "guest");
  assert.equal(storage.getItem("library"), '{"favorites":["guest"]}');
  assert.equal(storage.getItem("progress"), '{"movie:2":{"progress":8}}');
  setup(storage, "user-a");
  assert.equal(storage.getItem("library"), '{"favorites":["A"]}');
});

test("movie and TV identities and episode progress keys remain distinct", () => {
  const storage = memoryStorage({ owner: "user-a", progress: '{"movie:12":{"progress":5},"tv:12:1:2":{"progress":60}}' });
  setup(storage, "user-b");
  setup(storage, "user-a");
  assert.deepEqual(JSON.parse(storage.getItem("progress")), {
    "movie:12": { progress: 5 },
    "tv:12:1:2": { progress: 60 }
  });
});

test("guest state is inherited on first sign-in when no account snapshot exists", () => {
  const storage = memoryStorage({ owner: "guest", library: '{"favorites":["guest"]}', progress: '{"movie:2":{"progress":10}}' });
  setup(storage, "user-a");
  assert.equal(storage.getItem("library"), '{"favorites":["guest"]}');
  assert.equal(storage.getItem("progress"), '{"movie:2":{"progress":10}}');
});

test("partial account snapshots cannot inherit another owner's missing store", () => {
  const storage = memoryStorage({
    owner: "guest",
    library: '{"favorites":["guest"]}',
    progress: '{"movie:2":{"progress":10}}',
    "library:user:user-a": '{"favorites":["A"]}'
  });
  setup(storage, "user-a");
  assert.equal(storage.getItem("library"), '{"favorites":["A"]}');
  assert.equal(storage.getItem("progress"), "{}");
});
