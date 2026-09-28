import assert from "node:assert/strict";
import test from "node:test";

import { blendWeight, cornerPinMatrix } from "../src/renderer/tauri/screens.ts";

// The page's copies of `corner_pin_matrix` and `BlendCurve::weight` in
// `services/screens.rs`: a stage screen and a web-drawn audience screen must
// be pinned and faded as the native audience view is.

const apply = (m, x, y) => {
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
};
const close = ([ax, ay], [bx, by]) => Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6;

test("a corner pin moves each corner where it says", () => {
  const pin = { topLeft: [40, 20], topRight: [-30, 0], bottomRight: [0, -10], bottomLeft: [10, 0] };
  const m = cornerPinMatrix(1920, 1080, pin);
  assert.ok(m, "a transform");
  assert.ok(close(apply(m, 0, 0), [40, 20]));
  assert.ok(close(apply(m, 1920, 0), [1890, 0]));
  assert.ok(close(apply(m, 1920, 1080), [1920, 1070]));
  assert.ok(close(apply(m, 0, 1080), [10, 1080]));
});

test("no corner moved is no transform", () => {
  const still = { topLeft: [0, 0], topRight: [0, 0], bottomRight: [0, 0], bottomLeft: [0, 0] };
  assert.equal(cornerPinMatrix(1920, 1080, still), null);
});

test("blended edges add up to the whole picture", () => {
  for (const curve of ["linear", "cubic", "quadratic"]) {
    for (let step = 0; step <= 10; step += 1) {
      const t = step / 10;
      const sum = blendWeight(curve, t) + blendWeight(curve, 1 - t);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${curve} at ${t} adds to ${sum}`);
    }
  }
});
