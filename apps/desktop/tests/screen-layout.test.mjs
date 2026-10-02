import assert from "node:assert/strict";
import test from "node:test";

import {
  FULL_BOX,
  LAYOUT_PRESETS,
  boxStyle,
  isFullBox,
  screenIntoBoxTransform,
  wordsOfSlide,
} from "../src/shared/lib/screen-layout.mjs";
import { normalizeLayout } from "../src/shared/lib/looks-config.mjs";

test("a box is placed by its corner, as the compositor's `LayerBox::rect`", () => {
  assert.deepEqual(boxStyle({ xPercent: 50, yPercent: 84, widthPercent: 90, heightPercent: 24 }), {
    left: "5%",
    top: "72%",
    width: "90%",
    height: "24%",
  });
  assert.ok(isFullBox(FULL_BOX));
  assert.ok(isFullBox(undefined));
  assert.ok(!isFullBox({ xPercent: 50, yPercent: 50, widthPercent: 60, heightPercent: 100 }));
});

test("the screen goes into a box evenly, centred in it", () => {
  // A box half the screen wide and the whole height: the screen at half
  // size, centred down the left half.
  assert.equal(
    screenIntoBoxTransform({ xPercent: 25, yPercent: 50, widthPercent: 50, heightPercent: 100 }),
    "translate(0%, 25%) scale(0.5)",
  );
  assert.equal(screenIntoBoxTransform(FULL_BOX), "translate(0%, 0%) scale(1)");
});

test("a slide's words are its text boxes top to bottom, in the first one's font", () => {
  const words = wordsOfSlide([
    { type: "text", x: 0, y: 600, content: "second line", style: { fontFamily: "Serif" } },
    { type: "image", x: 0, y: 0, content: "bg.png" },
    {
      type: "text",
      x: 0,
      y: 100,
      content: "",
      textBody: { paragraphs: [{ runs: [{ text: "Amazing " }, { text: "grace" }] }, { runs: [{ text: "how sweet" }] }] },
      style: { fontFamily: "Inter", fontSize: 80 },
    },
    { type: "text", x: 0, y: 900, content: "hidden", isVisible: false },
    { type: "text", x: 0, y: 950, content: "   " },
  ]);
  assert.deepEqual(words, {
    text: "Amazing grace\nhow sweet\nsecond line",
    style: { fontFamily: "Inter", fontSize: 80 },
  });
  assert.equal(wordsOfSlide([{ type: "image", x: 0, y: 0, content: "x.png" }]), null);
  assert.equal(wordsOfSlide(null), null);
});

test("every preset is a layout the reader keeps as it is", () => {
  for (const preset of LAYOUT_PRESETS) {
    assert.deepEqual(normalizeLayout(preset.layout), preset.layout, preset.id);
  }
});
