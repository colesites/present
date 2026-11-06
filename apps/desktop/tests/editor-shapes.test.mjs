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

const shapes = load("../src/features/editor/lib/shapes.ts");
// The module runs in its own realm: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Every number in path data, and that it uses only what the renderers read. */
const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
const onlyRendererCommands = (d) => /^[MLCQZ0-9.\s-]+$/.test(d);

test("every preset fits its box and uses commands both renderers read", () => {
  for (const { value } of shapes.SHAPE_PRESETS) {
    const geometry = shapes.presetGeometry(value, 400, 200, 0);
    assert.equal(geometry.preset, value);
    for (const path of geometry.paths) {
      assert.ok(onlyRendererCommands(path.d), `${value}: ${path.d}`);
      const values = numbers(path.d);
      assert.ok(values.every((v) => v >= 0 && v <= 400), `${value} stays in the box`);
    }
  }
  assert.equal(shapes.presetGeometry("line", 400, 20).paths[0].fill, false, "a line is not filled");
});

test("an imported shape stretches with its box", () => {
  const element = {
    id: "s", type: "shape", x: 0, y: 0, width: 100, height: 50, content: "",
    geometry: { paths: [{ d: "M 0 0 L 100 0 C 100 25 50 50 0 50 Z" }] },
  };
  const next = shapes.fitGeometryToBox(element, { ...element, width: 200, height: 100 });
  assert.equal(next.geometry.paths[0].d, "M 0 0 L 200 0 C 200 50 100 100 0 100 Z");
});

test("a shape made here is drawn again, so its corners stay round", () => {
  const element = {
    id: "s", type: "shape", x: 0, y: 0, width: 100, height: 100, content: "",
    geometry: shapes.presetGeometry("roundRect", 100, 100, 20),
  };
  const next = shapes.fitGeometryToBox(element, { ...element, width: 300 });
  assert.equal(next.geometry.radius, 20);
  assert.deepEqual(plain(next.geometry), plain(shapes.presetGeometry("roundRect", 300, 100, 20)));
});

test("moving a shape leaves its paths alone", () => {
  const element = {
    id: "s", type: "shape", x: 0, y: 0, width: 100, height: 100, content: "",
    geometry: shapes.presetGeometry("star", 100, 100),
  };
  const moved = { ...element, x: 50 };
  assert.equal(shapes.fitGeometryToBox(element, moved), moved);
});

test("arcs and lone x or y moves scale on the right axis", () => {
  assert.equal(shapes.scalePathData("M 10 10 H 20 V 30 A 5 5 0 0 1 40 40", 2, 3), "M 20 30 H 40 V 90 A 10 15 0 0 1 80 120");
});

test("an old plain box takes an outline style by becoming a rectangle with paths", () => {
  const box = {
    id: "s", type: "shape", x: 0, y: 0, width: 100, height: 60, content: "",
    style: { backgroundColor: "#3b82f6", borderColor: "#ff0000", borderWidth: 4, borderRadius: 10 },
  };
  const outlined = shapes.withShapeOutline(box, { style: "dashed" });
  assert.equal(outlined.geometry.preset, "roundRect");
  assert.equal(outlined.geometry.radius, 10);
  assert.deepEqual(plain(outlined.style.line), { color: "#ff0000", width: 4, dash: [12, 8] });
  assert.equal(outlined.style.borderWidth, undefined);
  assert.equal(outlined.style.backgroundColor, "#3b82f6", "its fill is kept");
  assert.deepEqual(plain(shapes.shapeOutline(outlined)), { color: "#ff0000", width: 4, style: "dashed" });

  const wider = shapes.withShapeOutline(outlined, { width: 10 });
  assert.deepEqual(plain(wider.style.line.dash), [30, 20], "the dashes grow with the line");
});

test("changing the shape keeps its fill and outline; a line gets one", () => {
  const box = {
    id: "s", type: "shape", x: 0, y: 0, width: 100, height: 60, content: "",
    geometry: shapes.presetGeometry("rect", 100, 60), style: { backgroundColor: "#22c55e" },
  };
  const star = shapes.withShapePreset(box, "star");
  assert.equal(star.geometry.preset, "star");
  assert.equal(star.style.backgroundColor, "#22c55e");
  const line = shapes.withShapePreset(box, "line");
  assert.equal(line.style.line.color, "#22c55e");
  assert.equal(line.style.line.width, 8);
});

test("corners: only rectangles have them; zero makes a square corner", () => {
  const star = { id: "s", type: "shape", x: 0, y: 0, width: 100, height: 60, content: "", geometry: shapes.presetGeometry("star", 100, 60) };
  assert.equal(shapes.hasCorners(star), false);
  assert.equal(shapes.withCornerRadius(star, 20), star);
  const rect = { ...star, geometry: shapes.presetGeometry("rect", 100, 60) };
  assert.equal(shapes.withCornerRadius(rect, 12).geometry.preset, "roundRect");
  assert.equal(shapes.withCornerRadius(rect, 12).geometry.radius, 12);
  assert.equal(shapes.withCornerRadius(shapes.withCornerRadius(rect, 12), 0).geometry.preset, "rect");
});

const box = load("../src/features/editor/lib/box-transform.ts");
const round = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

test("an upright box resizes from the handle, the far side staying put", () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(round(box.resizeBox(start, "bottom-right", 50, 20)), { x: 100, y: 100, width: 250, height: 120 });
  assert.deepEqual(round(box.resizeBox(start, "top-left", 50, 20)), { x: 150, y: 120, width: 150, height: 80 });
  assert.deepEqual(round(box.resizeBox(start, "mid-right", 50, 999)), { x: 100, y: 100, width: 250, height: 100 });
});

test("a box turned a quarter turn grows along its own width", () => {
  // Turned 90 degrees, its right edge faces down the slide.
  const start = { x: 0, y: 0, width: 200, height: 100 };
  const grown = box.resizeBox(start, "mid-right", 0, 40, { rotation: 90 });
  assert.deepEqual(round(grown), { x: -20, y: 20, width: 240, height: 100 });
  // Its left end (the top of the turned box) stays where it was.
  const topOf = (b) => b.y + b.height / 2 - b.width / 2;
  assert.equal(Math.round(topOf(grown)), Math.round(topOf(start)));
});

test("a flipped box's left handle is on its right", () => {
  const start = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(round(box.resizeBox(start, "mid-left", 30, 0, { flipX: true })), { x: 0, y: 0, width: 230, height: 100 });
});

test("a corner with proportions kept, and the smallest size", () => {
  const start = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(round(box.resizeBox(start, "bottom-right", 200, 0, { keepAspect: true })), { x: 0, y: 0, width: 400, height: 200 });
  assert.equal(box.resizeBox(start, "bottom-right", -500, -500).width, 10);
});

test("the rotate handle points at the pointer", () => {
  const centre = { x: 0, y: 0 };
  assert.equal(box.rotationToward(centre, { x: 0, y: -10 }), 0);
  assert.equal(box.rotationToward(centre, { x: 10, y: 0 }), 90);
  assert.equal(box.rotationToward(centre, { x: -10, y: 0 }), -90);
  assert.equal(box.rotationToward(centre, { x: 10, y: -9 }, { snap: true }), 45);
  assert.equal(box.rotationToward(centre, { x: 10, y: 0.2 }), 90, "near a right angle sticks to it");
  assert.equal(box.rotationToward(centre, { x: 0, y: 10 }, { flipY: true }), 0);
});

const pictures = load("../src/features/editor/lib/pictures.ts");
const picture = (extra = {}) => ({ id: "p", type: "image", x: 100, y: 100, width: 400, height: 200, content: "a.png", ...extra });

test("cropping moves the box's edge, not the picture", () => {
  const cropped = pictures.withCrop(picture({ style: { crop: pictures.NO_CROP } }), { left: 0.25, top: 0, right: 0, bottom: 0.5 });
  assert.deepEqual(round({ x: cropped.x, y: cropped.y, width: cropped.width, height: cropped.height }), { x: 200, y: 100, width: 300, height: 100 });
  const back = pictures.withCrop(cropped, pictures.NO_CROP);
  assert.deepEqual(round({ x: back.x, y: back.y, width: back.width, height: back.height }), { x: 100, y: 100, width: 400, height: 200 });
});

test("a crop always leaves some of the picture", () => {
  const cropped = pictures.withCrop(picture({ style: { crop: pictures.NO_CROP } }), { left: 0.8, top: 0, right: 0.8, bottom: 0 });
  assert.ok(cropped.style.crop.left + cropped.style.crop.right <= 0.95 + 1e-9);
});

test("starting a crop keeps the look the fit gave it", () => {
  // A wide picture filling a square box: its sides were cut.
  const filled = pictures.startCrop(picture({ width: 200, height: 200 }), { width: 400, height: 200 });
  assert.deepEqual(plain(filled.style.crop), { left: 0.25, top: 0, right: 0.25, bottom: 0 });
  assert.equal(filled.width, 200);
  // Fitted inside the same box: the box shrinks to the picture.
  const fitted = pictures.startCrop(picture({ width: 200, height: 200, style: { objectFit: "contain" } }), { width: 400, height: 200 });
  assert.deepEqual(round({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height }), { x: 100, y: 150, width: 200, height: 100 });
  assert.deepEqual(plain(fitted.style.crop), plain(pictures.NO_CROP));
});

test("a picture chosen for an empty box gives the box its shape", () => {
  const empty = picture({ content: "", width: 400, height: 400 });
  const placed = pictures.withPicture(empty, "b.png", { width: 1600, height: 900 });
  assert.equal(placed.content, "b.png");
  assert.deepEqual(round({ x: placed.x, y: placed.y, width: placed.width, height: placed.height }), { x: 100, y: 187.5, width: 400, height: 225 });
  const replaced = pictures.withPicture(picture({ style: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } }), "c.png", { width: 10, height: 10 });
  assert.equal(replaced.width, 400, "a replaced picture keeps its box");
  assert.equal(replaced.style.crop, undefined, "and loses the old crop");
});
