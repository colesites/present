import assert from "node:assert/strict";
import test from "node:test";

import { MIN_SIZE, dragFrame, nudgeFrame, snapFrame } from "../src/features/themes/design-frames.mjs";

const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 };
const threshold = { x: 0.01, y: 0.015 };

test("moving shifts the box and keeps its size", () => {
  assert.deepEqual(dragFrame(box, "move", 0.1, -0.05), { x: 0.3, y: 0.15, width: 0.4, height: 0.3 });
});

test("each edge resizes from the opposite side", () => {
  assert.deepEqual(dragFrame(box, "e", 0.1, 0), { x: 0.2, y: 0.2, width: 0.5, height: 0.3 });
  assert.deepEqual(dragFrame(box, "w", 0.1, 0), { x: 0.3, y: 0.2, width: 0.3, height: 0.3 });
  assert.deepEqual(dragFrame(box, "n", 0, -0.1), { x: 0.2, y: 0.1, width: 0.4, height: 0.4 });
  assert.deepEqual(dragFrame(box, "se", 0.05, 0.05), { x: 0.2, y: 0.2, width: 0.45, height: 0.35 });
});

test("a box can't be made smaller than the least size, or dragged off the slide", () => {
  const tiny = dragFrame(box, "w", 0.9, 0);
  assert.equal(tiny.width, MIN_SIZE);
  assert.equal(Math.round((tiny.x + tiny.width) * 1000) / 1000, 0.6, "its right edge stays put");
  const gone = dragFrame(box, "move", 5, 5);
  assert.ok(gone.x < 1 && gone.y < 1, "some of it stays on the slide");
});

test("a moving box snaps its middle to the slide's middle, and says so", () => {
  const nearlyCentred = { x: 0.305, y: 0.6, width: 0.4, height: 0.2 };
  const { frame, guides } = snapFrame(nearlyCentred, "move", [], threshold);
  assert.equal(frame.x, 0.3);
  assert.deepEqual(guides, [{ axis: "x", at: 0.5 }]);
});

test("a resized edge snaps to the safe margin and to the other box", () => {
  const { frame } = snapFrame({ x: 0.1, y: 0.1, width: 0.846, height: 0.2 }, "e", [], threshold);
  assert.equal(frame.width, 0.85, "right edge to 0.95");
  const other = { x: 0.1, y: 0.63, width: 0.8, height: 0.37 };
  const { frame: bottom, guides } = snapFrame({ x: 0.1, y: 0.1, width: 0.8, height: 0.522 }, "s", [other], threshold);
  assert.equal(bottom.height, 0.53, "bottom edge to the other box's top");
  assert.deepEqual(guides, [{ axis: "y", at: 0.63 }]);
});

test("nothing near a line, nothing snaps", () => {
  const free = { x: 0.33, y: 0.37, width: 0.2, height: 0.1 };
  assert.deepEqual(snapFrame(free, "move", [], threshold), { frame: free, guides: [] });
});

test("arrow keys nudge by half a percent, or five with Shift", () => {
  assert.deepEqual(nudgeFrame(box, "ArrowRight", false), { ...box, x: 0.205 });
  assert.deepEqual(nudgeFrame(box, "ArrowUp", true), { ...box, y: 0.15 });
  assert.equal(nudgeFrame(box, "Enter", false), null);
});
