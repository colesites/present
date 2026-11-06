import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const load = (path) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Script(transpiled.outputText).runInContext(createContext({ module, exports: module.exports }));
  return module.exports;
};

const arrange = load("../src/features/editor/lib/arrange.ts");
const { UndoHistory } = load("../src/features/editor/lib/history.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

const box = (id, x, y, width = 100, height = 100, extra = {}) => ({ id, type: "shape", x, y, width, height, content: "", ...extra });
const at = (elements) => Object.fromEntries(elements.map((e) => [e.id, [Math.round(e.x), Math.round(e.y)]]));
const slide = { width: 1920, height: 1080 };

test("a turned object's frame is the box it turns in", () => {
  const b = arrange.elementBounds(box("a", 0, 0, 200, 100, { style: { rotation: 90 } }));
  assert.deepEqual(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)])), { left: 50, top: -50, right: 150, bottom: 150 });
});

test("picking one of a group picks the group", () => {
  const elements = [box("a", 0, 0, 100, 100, { groupId: "g" }), box("b", 200, 0, 100, 100, { groupId: "g" }), box("c", 400, 0)];
  assert.deepEqual(plain(arrange.withGroups(elements, ["a"])), ["a", "b"]);
});

test("several align to each other; one aligns to the slide", () => {
  const elements = [box("a", 10, 0), box("b", 300, 50, 50, 50), box("c", 700, 500)];
  assert.deepEqual(at(arrange.alignElements(elements, ["a", "b"], "left", slide)), { a: [10, 0], b: [10, 50], c: [700, 500] });
  assert.deepEqual(at(arrange.alignElements(elements, ["a", "b"], "bottom", slide)), { a: [10, 0], b: [300, 50], c: [700, 500] });
  assert.deepEqual(at(arrange.alignElements(elements, ["c"], "center", slide)), { a: [10, 0], b: [300, 50], c: [910, 500] });
  assert.deepEqual(at(arrange.alignElements(elements, ["c"], "middle", slide)), { a: [10, 0], b: [300, 50], c: [700, 490] });
});

test("a group aligns as one, keeping its shape", () => {
  const elements = [box("a", 100, 100, 100, 100, { groupId: "g" }), box("b", 300, 200, 100, 100, { groupId: "g" })];
  assert.deepEqual(at(arrange.alignElements(elements, ["a"], "left", slide)), { a: [0, 100], b: [200, 200] });
});

test("three spread out with equal gaps, the outer two staying", () => {
  const elements = [box("a", 0, 0), box("b", 150, 0), box("c", 900, 0)];
  assert.deepEqual(at(arrange.distributeElements(elements, ["a", "b", "c"], "horizontal")), { a: [0, 0], b: [450, 0], c: [900, 0] });
});

test("grouping puts the group together at the top one's place", () => {
  const elements = [box("a", 0, 0), box("x", 0, 0), box("b", 0, 0), box("y", 0, 0)];
  const grouped = arrange.groupElements(elements, ["a", "b"], "g1");
  assert.deepEqual(plain(grouped.map((e) => e.id)), ["x", "a", "b", "y"]);
  assert.ok(grouped.filter((e) => e.groupId === "g1").length === 2);
  const ungrouped = arrange.ungroupElements(grouped, ["a"]);
  assert.ok(ungrouped.every((e) => !e.groupId));
});

test("copies get ids and groups of their own, moved by the offset", () => {
  let n = 0;
  const source = [box("a", 0, 0, 100, 100, { groupId: "g", isLocked: true }), box("b", 10, 10, 100, 100, { groupId: "g" })];
  const copies = arrange.copiesOf(source, 20, () => `new${++n}`);
  assert.deepEqual(plain(copies.map((e) => [e.id, e.x, e.y, e.groupId, e.isLocked])), [
    ["new1", 20, 20, "new1_group", false],
    ["new2", 30, 30, "new1_group", false],
  ]);
  assert.equal(source[0].x, 0, "the originals are not changed");
});

test("moving and deleting leave locked objects alone", () => {
  const elements = [box("a", 0, 0), box("b", 0, 0, 100, 100, { isLocked: true })];
  assert.deepEqual(at(arrange.moveElements(elements, ["a", "b"], 5, 5)), { a: [5, 5], b: [0, 0] });
  assert.deepEqual(plain(arrange.deleteElements(elements, ["a", "b"]).map((e) => e.id)), ["b"]);
});

test("a group resized keeps each object's place in it", () => {
  const elements = [box("a", 0, 0, 100, 100), box("b", 100, 100, 100, 100)];
  const scaled = arrange.scaleElements(elements, ["a", "b"], { left: 0, top: 0, right: 200, bottom: 200 }, { left: 0, top: 0, right: 400, bottom: 200 });
  assert.deepEqual(plain(scaled.map((e) => [e.x, e.y, e.width, e.height])), [[0, 0, 200, 100], [200, 100, 200, 100]]);
});

test("a move snaps to the slide's centre and another object's edge", () => {
  const moving = { left: 0, top: 0, right: 100, bottom: 100 };
  const near = arrange.snapMove(moving, 907, 0, [], slide, 8);
  assert.equal(near.dx, 910, "its centre on the slide's centre");
  assert.deepEqual(plain(near.guides), [{ axis: "x", at: 960 }, { axis: "y", at: 0 }]);
  const toOther = arrange.snapMove(moving, 0, 395, [{ left: 500, top: 500, right: 600, bottom: 600 }], slide, 8);
  assert.equal(toOther.dy, 400, "its bottom on the other's top");
  const far = arrange.snapMove(moving, 300, 300, [], slide, 8);
  assert.deepEqual([far.dx, far.dy, far.guides.length], [300, 300, 0]);
});

test("undo: changes close together are one step; redo goes forward", () => {
  const history = new UndoHistory(10, 600);
  history.record("a", 0);
  history.record("b", 100); // the same drag
  history.record("c", 1000); // a new step
  assert.equal(history.undo("d"), "c");
  assert.equal(history.undo("c"), "a");
  assert.equal(history.undo("a"), null);
  assert.equal(history.redo("a"), "c");
  assert.equal(history.redo("c"), "d");
  assert.equal(history.canRedo, false);
});

test("undo: a new change drops what could be redone; a new press is a new step", () => {
  const history = new UndoHistory(10, 600);
  history.record("a", 0);
  history.undo("b");
  history.record("a", 50);
  assert.equal(history.canRedo, false);
  history.breakStep();
  history.record("x", 60);
  assert.equal(history.undo("y"), "x");
  assert.equal(history.undo("x"), "a");
});

const slides = load("../src/features/editor/lib/slides.ts");
const deckSlide = (id, extra = {}) => ({ id, text: id, elements: [], ...extra });

test("a copied slide shares no ids with the original", () => {
  const original = deckSlide("s1", {
    elements: [
      { id: "__theme-bg", type: "shape", x: 0, y: 0, width: 10, height: 10, content: "" },
      { id: "s1_text_0", type: "text", x: 0, y: 0, width: 10, height: 10, content: "Hi" },
      { id: "pptx_1_3", type: "shape", x: 0, y: 0, width: 10, height: 10, content: "", groupId: "g" },
      { id: "pptx_1_4", type: "shape", x: 0, y: 0, width: 10, height: 10, content: "", groupId: "g" },
    ],
  });
  const copy = slides.copySlide(original, "s2");
  assert.equal(copy.id, "s2");
  assert.deepEqual(plain(copy.elements.map((e) => e.id)), ["__theme-bg", "s2_text_0", "s2_shape_2", "s2_shape_3"]);
  assert.equal(copy.elements[2].groupId, copy.elements[3].groupId);
  assert.notEqual(copy.elements[2].groupId, "g");
  assert.equal(original.elements[1].id, "s1_text_0", "the original is not changed");
});

test("slides are put in after one and moved a place at a time", () => {
  const list = [deckSlide("a"), deckSlide("b"), deckSlide("c")];
  assert.deepEqual(plain(slides.insertSlidesAfter(list, "a", [deckSlide("x")]).map((s) => s.id)), ["a", "x", "b", "c"]);
  assert.deepEqual(plain(slides.insertSlidesAfter(list, null, [deckSlide("x")]).map((s) => s.id)), ["a", "b", "c", "x"]);
  assert.deepEqual(plain(slides.moveSlide(list, "b", -1).map((s) => s.id)), ["b", "a", "c"]);
  assert.equal(slides.moveSlide(list, "c", 1), list, "the last cannot go further down");
});

test("a picture background sits behind everything and can be taken away", () => {
  const withText = deckSlide("a", { elements: [{ id: "a_text_0", type: "text", x: 0, y: 0, width: 1, height: 1, content: "" }] });
  const pictured = slides.withPictureBackground(withText, "bg.png", { width: 1920, height: 1080 });
  assert.equal(pictured.elements[0].id, slides.PICTURE_BACKGROUND_ID);
  assert.equal(pictured.elements[0].isLocked, true);
  assert.equal(slides.pictureBackgroundOf(pictured).content, "bg.png");
  const replaced = slides.withPictureBackground(pictured, "other.png", { width: 1920, height: 1080 });
  assert.equal(replaced.elements.length, 2, "one picture background at a time");
  assert.equal(slides.withPictureBackground(replaced, null, { width: 1920, height: 1080 }).elements.length, 1);
});

test("one slide's background given to another keeps the other's objects", () => {
  const source = slides.withPictureBackground(deckSlide("a", { backgroundColor: "#112233", useBackgroundColor: true, backgroundId: "m1" }), "bg.png", { width: 1920, height: 1080 });
  const target = deckSlide("b", { backgroundColor: "#ffffff", elements: [{ id: "b_text_0", type: "text", x: 0, y: 0, width: 1, height: 1, content: "Mine" }] });
  const next = slides.withBackgroundOf(target, source);
  assert.equal(next.backgroundColor, "#112233");
  assert.equal(next.backgroundId, "m1");
  assert.deepEqual(plain(next.elements.map((e) => e.id)), [slides.PICTURE_BACKGROUND_ID, "b_text_0"]);
});

test("a page imported as a picture is the slide's background, old imports too", () => {
  const page = (id) => ({ id, type: "image", x: 0, y: 0, width: 1920, height: 1080, content: "p.png" });
  assert.equal(slides.isPictureBackground(page(slides.PICTURE_BACKGROUND_ID)), true);
  assert.equal(slides.isPictureBackground(page("pdf_page_12_image")), true);
  assert.equal(slides.isPictureBackground(page("pptx_slide_3_image")), true);
  assert.equal(slides.isPictureBackground(page("pptx_3_1")), false);
  const old = deckSlide("a", { elements: [page("pdf_page_1_image")] });
  assert.equal(slides.withPictureBackground(old, "new.png", { width: 1920, height: 1080 }).elements.length, 1, "replacing it leaves one");
});

const builds = load("../src/features/editor/lib/builds.ts");

test("a slide's builds make steps the way the screens draw them", () => {
  const el = (id, b) => ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, content: "", builds: b });
  const elements = [
    el("title", { in: { effect: "fade", durationMs: 400, start: "with-previous" } }),
    el("a", { in: { effect: "fly", direction: "left", durationMs: 500, start: "on-click" } }),
    el("b", { in: { effect: "wipe", durationMs: 300, delayMs: 200, start: "after-previous" }, out: { effect: "fade", durationMs: 300, start: "on-click" } }),
    { id: "plain", type: "shape", x: 0, y: 0, width: 1, height: 1, content: "" },
  ];
  const timeline = builds.buildTimeline(elements);
  assert.deepEqual(plain(timeline.placed.map((p) => [p.elementId, p.phase, p.step, p.beginMs])), [
    ["title", "in", 0, 0],
    ["a", "in", 1, 0],
    ["b", "in", 1, 700],
    ["b", "out", 2, 0],
  ]);
  assert.equal(timeline.clickSteps, 2);
  assert.equal(builds.clickStepsOf([elements[3]]), 0);

  const reordered = builds.withBuildOrder(elements, [
    { elementId: "b", phase: "out" },
    { elementId: "a", phase: "in" },
  ]);
  assert.equal(reordered[2].builds.out.order, 0);
  assert.equal(reordered[1].builds.in.order, 1);
});
