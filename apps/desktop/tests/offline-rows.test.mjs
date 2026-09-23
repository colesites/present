import assert from "node:assert/strict";
import test from "node:test";

import {
  changedRows,
  fromQueuedChange,
  readRowKey,
  rowKey,
  rowsOf,
  toQueuedChange,
} from "../src/renderer/shared/offline/offline-rows.mjs";

// The library on this machine is SQLite (`services::store`); this is the part
// that decides what an edit writes there.

const library = () => ({
  categories: [{ _id: "cat_1", orgId: "org_1", name: "Songs" }],
  libraryItems: [
    { _id: "item_1", orgId: "org_1", title: "Amazing grace" },
    { _id: "item_2", orgId: "org_2", title: "Be thou my vision" },
  ],
  services: [{ _id: "svc_1", orgId: "org_1", name: "Sunday morning" }],
  messages: [],
});

/** What the store holds after everything in `state` has been written. */
const written = (state) => {
  const map = new Map();
  for (const [key, row] of rowsOf(state)) {
    map.set(key, row.body);
  }
  return map;
};

test("a library with nothing written yet writes every row once, with its kind", () => {
  const state = library();
  const { puts, removals } = changedRows(new Map(), rowsOf(state));

  assert.deepEqual(
    puts.map((row) => [row.kind, row.workspace, row.id]),
    [
      ["category", "org_1", "cat_1"],
      ["library", "org_1", "item_1"],
      ["library", "org_2", "item_2"],
      ["service", "org_1", "svc_1"],
    ],
  );
  assert.deepEqual(removals, []);
});

test("one edit writes one row, whatever else the library holds", () => {
  const state = library();
  const store = written(state);

  // What every edit in localData.ts does: a new object for the thing that
  // changed, and the rest of the library left exactly as it was.
  state.services[0] = { ...state.services[0], name: "Sunday evening" };

  const { puts, removals } = changedRows(store, rowsOf(state));
  assert.equal(puts.length, 1, "one row");
  assert.equal(puts[0].id, "svc_1");
  assert.equal(puts[0].body.name, "Sunday evening");
  assert.deepEqual(removals, []);
});

test("nothing changed writes nothing", () => {
  const state = library();
  const { puts, removals } = changedRows(written(state), rowsOf(state));
  assert.deepEqual(puts, []);
  assert.deepEqual(removals, []);
});

test("a thing that goes leaves no row behind", () => {
  const state = library();
  const store = written(state);
  state.categories = [];

  const { puts, removals } = changedRows(store, rowsOf(state));
  assert.deepEqual(puts, []);
  assert.deepEqual(
    removals.map((row) => [row.kind, row.workspace, row.id]),
    [["category", "org_1", "cat_1"]],
  );
});

test("a soft delete is a write, not a removal: the sync still has to send it", () => {
  const state = library();
  const store = written(state);
  state.libraryItems[0] = { ...state.libraryItems[0], deleted: true };

  const { puts, removals } = changedRows(store, rowsOf(state));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.deleted, true);
  assert.deepEqual(removals, []);
});

test("half-made things are nobody's row yet", () => {
  const rows = rowsOf({
    categories: [{ _id: "cat_1" }, { orgId: "org_1" }, {}],
    libraryItems: [{ _id: "item_1", orgId: "org_1" }],
    services: [],
    messages: [],
  });
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].id, "item_1");
});

test("no id, however punctuated, can spell another row's name", () => {
  const awkward = rowKey("library", "org_1", 'a","b');
  assert.notEqual(awkward, rowKey("library", 'org_1","a', "b"));
  assert.deepEqual(readRowKey(awkward), {
    kind: "library",
    workspace: "org_1",
    id: 'a","b',
  });
});

test("a change waiting for the server comes back from the store as it went in", () => {
  const change = {
    id: "queued_1",
    orgId: "org_1",
    entityType: "service",
    entityId: "svc_1",
    operation: "update",
    payload: { name: "Sunday morning", items: [{ type: "library" }] },
    updatedAt: 1_700_000_000_000,
    version: 4,
  };

  assert.deepEqual(toQueuedChange(change), {
    id: "queued_1",
    workspace: "org_1",
    kind: "service",
    entityId: "svc_1",
    operation: "update",
    payload: change.payload,
    queuedAt: 1_700_000_000_000,
    version: 4,
  });
  assert.deepEqual(fromQueuedChange(toQueuedChange(change)), change);
});
