import assert from "node:assert/strict";
import test from "node:test";

import { wallGrid } from "../src/features/stage/wall.ts";

// Multiview is a wall of same-sized TVs, TV-shaped whatever the window, laid
// out to make them as large as they can be.

test("four screens in a wide window are two by two", () => {
  const grid = wallGrid(4, 1880, 1000, 10);
  assert.equal(grid.columns, 2);
  assert.equal(grid.rows, 2);
});

test("sixteen are four by four", () => {
  const grid = wallGrid(16, 1880, 1060, 10);
  assert.equal(grid.columns, 4);
  assert.equal(grid.rows, 4);
});

test("every TV keeps its shape, however many and whatever the window", () => {
  for (const count of [1, 2, 3, 5, 6, 9, 10, 12, 16]) {
    for (const [width, height] of [[1880, 1000], [1200, 1800], [3000, 600]]) {
      const grid = wallGrid(count, width, height, 10);
      assert.ok(Math.abs(grid.tileWidth / grid.tileHeight - 16 / 9) < 0.02, `${count} in ${width}x${height}`);
      assert.ok(grid.columns * grid.rows >= count, "room for each");
      assert.ok(grid.columns * grid.tileWidth + (grid.columns - 1) * 10 <= width, "fits across");
      assert.ok(grid.rows * grid.tileHeight + (grid.rows - 1) * 10 <= height, "fits down");
    }
  }
});

test("a tall window stacks, a very wide one lines them up", () => {
  assert.equal(wallGrid(3, 800, 1800, 10).columns, 1);
  assert.equal(wallGrid(3, 3000, 500, 10).rows, 1);
});
