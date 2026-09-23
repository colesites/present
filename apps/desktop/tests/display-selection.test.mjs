import assert from "node:assert/strict";
import test from "node:test";

import { selectPreferredDisplay } from "../src/shared/lib/display-selection.mjs";

/**
 * Characterisation suite: this pins the CURRENT Electron behaviour of
 * `display.service.ts` so the Rust port can be checked against it. If a case
 * here changes, that is a product decision, not a refactor.
 */

const display = (id, width, height) => ({ id, bounds: { width, height } });

const LAPTOP = display(1, 1512, 982);
const PROJECTOR = display(2, 1920, 1080);
const TV = display(3, 3840, 2160);

test("with only the built-in display, the role lands on it", () => {
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP],
    primaryId: LAPTOP.id,
  });

  assert.equal(chosen.id, LAPTOP.id);
});

test("prefers the largest external display over the primary", () => {
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, PROJECTOR, TV],
    primaryId: LAPTOP.id,
  });

  assert.equal(chosen.id, TV.id, "the 4K TV outranks the 1080p projector");
});

test("an explicit choice beats the largest-external rule", () => {
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, PROJECTOR, TV],
    primaryId: LAPTOP.id,
    preferredDisplayId: PROJECTOR.id,
  });

  assert.equal(chosen.id, PROJECTOR.id);
});

test("an explicit choice may be the primary display", () => {
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, TV],
    primaryId: LAPTOP.id,
    preferredDisplayId: LAPTOP.id,
  });

  assert.equal(chosen.id, LAPTOP.id, "operators can deliberately output to the laptop");
});

test("an unplugged explicit choice falls back to the largest external", () => {
  // The projector was chosen, then someone pulled the cable mid-service.
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, TV],
    primaryId: LAPTOP.id,
    preferredDisplayId: PROJECTOR.id,
  });

  assert.equal(chosen.id, TV.id);
});

test("an unplugged explicit choice with no externals left falls back to primary", () => {
  const chosen = selectPreferredDisplay({
    displays: [LAPTOP],
    primaryId: LAPTOP.id,
    preferredDisplayId: PROJECTOR.id,
  });

  assert.equal(chosen.id, LAPTOP.id, "never leave the role without a display");
});

test("equal-area externals resolve deterministically to the first listed", () => {
  const first = display(2, 1920, 1080);
  const second = display(3, 1920, 1080);

  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, first, second],
    primaryId: LAPTOP.id,
  });

  assert.equal(
    chosen.id,
    first.id,
    "a stable tie-break matters: the audience screen must not swap on reconnect",
  );
});

test("area, not width, decides between differently shaped displays", () => {
  const ultrawide = display(2, 3440, 1440); // 4 953 600
  const uhd = display(3, 3840, 2160); //       8 294 400

  const chosen = selectPreferredDisplay({
    displays: [LAPTOP, ultrawide, uhd],
    primaryId: LAPTOP.id,
  });

  assert.equal(chosen.id, uhd.id);
});

test("no displays yields null rather than throwing", () => {
  assert.equal(selectPreferredDisplay({ displays: [], primaryId: 1 }), null);
});

test("a primary id that matches nothing still returns a display", () => {
  // Guards the hot-plug window where the reported primary has already gone.
  const chosen = selectPreferredDisplay({
    displays: [PROJECTOR, TV],
    primaryId: 999,
  });

  assert.ok(chosen, "must not return null while displays exist");
  assert.equal(chosen.id, TV.id);
});

test("null and undefined preferred ids both mean 'no explicit choice'", () => {
  const withNull = selectPreferredDisplay({
    displays: [LAPTOP, TV],
    primaryId: LAPTOP.id,
    preferredDisplayId: null,
  });
  const withUndefined = selectPreferredDisplay({
    displays: [LAPTOP, TV],
    primaryId: LAPTOP.id,
    preferredDisplayId: undefined,
  });

  assert.equal(withNull.id, TV.id);
  assert.equal(withUndefined.id, TV.id);
});

test("the input array is not mutated", () => {
  const displays = [LAPTOP, PROJECTOR, TV];
  const order = displays.map((entry) => entry.id);

  selectPreferredDisplay({ displays, primaryId: LAPTOP.id });

  assert.deepEqual(
    displays.map((entry) => entry.id),
    order,
    "sorting must not reorder the caller's display list",
  );
});
