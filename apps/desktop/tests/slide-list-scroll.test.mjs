import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSlideListScrollTop,
  resolveSlideListScrollTop,
} from "../src/features/editor/lib/slide-list-scroll.mjs";

test("restores a saved position after an unexpected reset to zero", () => {
  assert.equal(
    resolveSlideListScrollTop({ current: 0, saved: 640, maxScrollTop: 1_200 }),
    640,
  );
});

test("does not override a valid current scroll position", () => {
  assert.equal(
    resolveSlideListScrollTop({ current: 320, saved: 640, maxScrollTop: 1_200 }),
    320,
  );
});

test("clamps restoration when slides are removed", () => {
  assert.equal(
    resolveSlideListScrollTop({ current: 0, saved: 900, maxScrollTop: 400 }),
    400,
  );
  assert.equal(clampSlideListScrollTop(-10, 400), 0);
});
