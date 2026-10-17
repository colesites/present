import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIMER_CATEGORY,
  nextInCategory,
  normalizeTimerCategories,
  reorderWithinCategory,
} from "../src/renderer/shared/hooks/useTimers.ts";

const timer = (id, categoryId) => ({
  id,
  name: id,
  categoryId,
  type: "countdown",
  duration: "00:05:00",
  hour: 9,
  minute: 0,
  meridiem: "AM",
  elapsedStart: "00:00",
  elapsedEnd: "00:05",
  isRunning: false,
  secondsValue: 300,
});

const ids = (timers) => timers.map((each) => each.id);

test("timers saved before there were categories go into the first", () => {
  const { categories, timers } = normalizeTimerCategories(undefined, [
    timer("a", undefined),
    timer("b", undefined),
  ]);
  assert.deepEqual(categories, [DEFAULT_TIMER_CATEGORY]);
  assert.ok(timers.every((each) => each.categoryId === DEFAULT_TIMER_CATEGORY.id));
});

test("a timer in a category that is gone goes into the first, and others keep theirs", () => {
  const stored = [
    { id: "sunday", name: "Sunday" },
    { id: "youth", name: "Youth" },
    { id: "youth", name: "A repeat" },
    { name: "No id" },
  ];
  const { categories, timers } = normalizeTimerCategories(stored, [
    timer("a", "youth"),
    timer("b", "deleted"),
  ]);
  assert.deepEqual(
    categories.map((category) => category.id),
    ["sunday", "youth"],
  );
  assert.deepEqual(
    timers.map((each) => each.categoryId),
    ["youth", "sunday"],
  );
});

test("reordering moves a timer within its category and leaves the others where they were", () => {
  const timers = [timer("s1", "s"), timer("y1", "y"), timer("s2", "s"), timer("s3", "s")];
  // The Timer tab shows s1, s2, s3: drag the first to the last place.
  assert.deepEqual(ids(reorderWithinCategory(timers, "s", 0, 2)), ["y1", "s2", "s3", "s1"]);
  // And the last back to the first.
  assert.deepEqual(ids(reorderWithinCategory(timers, "s", 2, 0)), ["s3", "s1", "y1", "s2"]);
  assert.equal(reorderWithinCategory(timers, "s", 1, 1), timers, "not moved");
  assert.equal(reorderWithinCategory(timers, "s", 0, 9), timers, "nowhere to go");
});

test("Auto starts the next timer of the same category, never another's", () => {
  const timers = [timer("s1", "s"), timer("y1", "y"), timer("s2", "s"), timer("y2", "y")];
  assert.equal(nextInCategory(timers, 0)?.id, "s2");
  assert.equal(nextInCategory(timers, 1)?.id, "y2");
  assert.equal(nextInCategory(timers, 2), null, "the last of its category");
  assert.equal(nextInCategory(timers, 9), null);
});
