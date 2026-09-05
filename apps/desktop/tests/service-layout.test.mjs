import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLayoutGroupOrder,
  moveLayoutGroup,
  resolveLayoutInsertIndex,
} from "../src/features/services/lib/service-layout.mjs";

const layout = [
  { type: "group", id: "welcome" },
  { type: "item", key: "media:clip:1:standalone" },
  { type: "group", id: "worship" },
  { type: "group", id: "word" },
];

test("moves a group down past a standalone item", () => {
  assert.deepEqual(moveLayoutGroup(layout, "welcome", 2), [
    { type: "item", key: "media:clip:1:standalone" },
    { type: "group", id: "welcome" },
    { type: "group", id: "worship" },
    { type: "group", id: "word" },
  ]);
});

test("moves a group up above every other row", () => {
  assert.deepEqual(moveLayoutGroup(layout, "word", 0), [
    { type: "group", id: "word" },
    { type: "group", id: "welcome" },
    { type: "item", key: "media:clip:1:standalone" },
    { type: "group", id: "worship" },
  ]);
});

test("moves a group to the end when dropped past the last row", () => {
  assert.deepEqual(moveLayoutGroup(layout, "welcome", layout.length), [
    { type: "item", key: "media:clip:1:standalone" },
    { type: "group", id: "worship" },
    { type: "group", id: "word" },
    { type: "group", id: "welcome" },
  ]);
});

test("treats both drop lines around a group as a no-op", () => {
  assert.equal(moveLayoutGroup(layout, "worship", 2), null);
  assert.equal(moveLayoutGroup(layout, "worship", 3), null);
});

test("ignores unknown groups and non-numeric targets", () => {
  assert.equal(moveLayoutGroup(layout, "missing", 0), null);
  assert.equal(moveLayoutGroup(layout, "welcome", Number.NaN), null);
  assert.equal(moveLayoutGroup(undefined, "welcome", 0), null);
});

test("leaves the source layout untouched", () => {
  const snapshot = JSON.parse(JSON.stringify(layout));
  moveLayoutGroup(layout, "welcome", 3);
  assert.deepEqual(layout, snapshot);
});

test("renumbers group order to follow the layout", () => {
  const groups = [
    { id: "welcome", name: "Welcome", order: 0 },
    { id: "worship", name: "Worship", order: 1 },
    { id: "word", name: "Word", order: 2 },
  ];
  const reordered = moveLayoutGroup(layout, "word", 0);

  assert.deepEqual(applyLayoutGroupOrder(reordered, groups), [
    { id: "word", name: "Word", order: 0 },
    { id: "welcome", name: "Welcome", order: 1 },
    { id: "worship", name: "Worship", order: 2 },
  ]);
});

test("keeps groups missing from the layout at the end", () => {
  const groups = [
    { id: "orphan", name: "Orphan", order: 0 },
    { id: "welcome", name: "Welcome", order: 1 },
  ];

  assert.deepEqual(applyLayoutGroupOrder(layout, groups), [
    { id: "welcome", name: "Welcome", order: 0 },
    { id: "orphan", name: "Orphan", order: 3 },
  ]);
});

test("shifts the insert index only when a row moves down past its own slot", () => {
  assert.equal(resolveLayoutInsertIndex(4, 0, 3), 2);
  assert.equal(resolveLayoutInsertIndex(4, 3, 1), 1);
  assert.equal(resolveLayoutInsertIndex(4, -1, 3), 3);
  assert.equal(resolveLayoutInsertIndex(4, 1, 99), 3);
  assert.equal(resolveLayoutInsertIndex(4, 1, -5), 0);
});
