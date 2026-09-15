import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { convertPayloadToPresentation } from "../src/main/lib/pptx-payload.mjs";

// The PPTX importer's conversion from parse_pptx.py's payload to slides.
// `src-tauri/src/services/pptx` replaces the parser and this together, and is
// tested against tests/fixtures/pptx/*.expected.json.

const run = (text, extra = {}) => ({
  text,
  font_name: "Calibri",
  font_size_px: 24,
  bold: false,
  italic: false,
  underline: false,
  color: "#000000",
  character_spacing_px: 0,
  ...extra,
});

const body = (paragraphs, extra = {}) => ({
  inset_left_px: 10,
  inset_right_px: 10,
  inset_top_px: 5,
  inset_bottom_px: 5,
  vertical_align: "center",
  wrap: true,
  autofit: "none",
  paragraphs,
  ...extra,
});

const paragraph = (runs, extra = {}) => ({
  alignment: "left",
  space_before_px: 0,
  space_after_px: 0,
  line_spacing: 1,
  runs,
  ...extra,
});

const presentation = (shapes, background = { type: "solid", color: "#FFFFFF" }) => ({
  mode: "pptx",
  slide_width_px: 960,
  slide_height_px: 720,
  slides: [{ index: 0, background, shapes }],
});

test("everything is scaled onto 1920×1080, sizes by the smaller scale", () => {
  const converted = convertPayloadToPresentation(
    presentation([
      {
        id: 4,
        name: "Box",
        type: "text",
        x: 100,
        y: 100,
        width: 200,
        height: 50,
        rotation: 12.5,
        text_body: body([paragraph([run("Hi", { font_size_px: 20, character_spacing_px: 2 })], { space_before_px: 8 })]),
      },
    ]),
    "/decks/Sunday Service.pptx",
  );
  assert.equal(converted.title, "Sunday Service");
  assert.deepEqual([converted.slideWidthPx, converted.slideHeightPx], [1920, 1080]);
  const [element] = converted.slides[0].elements;
  assert.equal(element.id, "pptx_1_4");
  assert.deepEqual([element.x, element.y, element.width, element.height], [200, 150, 400, 75]);
  assert.equal(element.style.rotation, 12.5, "rotation is not scaled");
  assert.equal(element.style.fontSize, 30, "20 × min(2, 1.5)");
  assert.equal(element.style.paddingLeft, 20);
  assert.equal(element.style.paddingTop, 7.5);
  const [scaledParagraph] = element.textBody.paragraphs;
  assert.equal(scaledParagraph.spaceBefore, 12);
  assert.equal(scaledParagraph.runs[0].fontSize, 30);
  assert.equal(scaledParagraph.runs[0].letterSpacing, 4, "letter spacing by the horizontal scale");
});

test("a line height over 4 is a length and is scaled; 4 or under is a multiplier and is not", () => {
  const converted = convertPayloadToPresentation(
    presentation([
      {
        id: 1,
        type: "text",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        text_body: body([
          paragraph([run("a")], { line_spacing: 4 }),
          paragraph([run("b")], { line_spacing: 381000 }),
        ]),
      },
    ]),
    "x.pptx",
  );
  const [first, second] = converted.slides[0].elements[0].textBody.paragraphs;
  assert.equal(first.lineHeight, 4);
  assert.equal(second.lineHeight, 571500);
});

test("the first run and paragraph style the element; empty values fall back", () => {
  const converted = convertPayloadToPresentation(
    presentation([
      {
        id: 2,
        type: "text",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        text_body: body(
          [paragraph([run("x", { font_name: "", font_size_px: 0, bold: true, underline: true, color: "" })], { alignment: "" })],
          { vertical_align: "bottom", inset_left_px: 0 },
        ),
      },
    ]),
    "x.pptx",
  );
  const [element] = converted.slides[0].elements;
  assert.deepEqual(
    {
      fontFamily: element.style.fontFamily,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight,
      textDecoration: element.style.textDecoration,
      color: element.style.color,
      textAlign: element.style.textAlign,
      verticalAlign: element.style.verticalAlign,
      paddingLeft: element.style.paddingLeft,
    },
    {
      fontFamily: "Calibri",
      fontSize: 27,
      fontWeight: "700",
      textDecoration: "underline",
      color: "#000000",
      textAlign: "left",
      verticalAlign: "bottom",
      paddingLeft: 0,
    },
  );
  const structured = element.textBody.paragraphs[0].runs[0];
  assert.equal(structured.fontFamily, undefined, "an empty font name is left out");
  assert.equal(structured.fontSize, undefined, "a zero size is left out");
  assert.equal(element.textBody.verticalAlign, "bottom");
});

test("groups are flattened, tables become their text, lines become bordered shapes, unknowns vanish", () => {
  const cell = (text) => ({ text_body: body([paragraph([run(text)])]) });
  const converted = convertPayloadToPresentation(
    presentation([
      {
        id: 10,
        type: "group",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        children: [{ id: 11, type: "text", x: 1, y: 1, width: 1, height: 1, text_body: body([paragraph([run("in group")])]) }],
      },
      {
        id: 12,
        type: "table",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rows: [
          { cells: [cell(" a "), cell(""), cell("b")] },
          { cells: [cell(""), cell("  ")] },
          { cells: [cell("c")] },
        ],
      },
      { id: 13, type: "line", x: 0, y: 0, width: 50, height: 0, line_color: "#FF0000", line_width_px: 2 },
      { id: 14, type: "unknown", x: 0, y: 0, width: 5, height: 5 },
    ]),
    "x.pptx",
  );
  const elements = converted.slides[0].elements;
  assert.deepEqual(
    elements.map((element) => [element.id, element.type]),
    [
      ["pptx_1_11", "text"],
      ["pptx_1_12", "text"],
      ["pptx_1_13", "shape"],
    ],
  );
  assert.equal(elements[1].content, "a | b\nc", "empty cells and empty rows are left out");
  assert.equal(elements[1].textBody.paragraphs[0].runs[0].fontSize, 24, "16 × 1.5");
  assert.equal(elements[1].style.verticalAlign, "top");
  assert.deepEqual(
    [elements[2].style.backgroundColor, elements[2].style.borderColor, elements[2].style.borderWidth],
    ["transparent", "#FF0000", 3],
  );
  assert.equal(converted.slides[0].textContent, "in group\na | b\nc");
});

test("pictures become data URLs; a background picture comes first and leaves no colour", () => {
  const converted = convertPayloadToPresentation(
    presentation(
      [
        { id: 1, type: "image", x: 0, y: 0, width: 10, height: 10, format: "JPG", data: "AAAA" },
        { id: 2, type: "image", x: 0, y: 0, width: 10, height: 10, format: "png", data: "" },
      ],
      { type: "image", format: "png", data: "BBBB", color: "#123456" },
    ),
    "x.pptx",
  );
  const [background, jpeg, blank] = converted.slides[0].elements;
  assert.equal(background.id, "pptx_bg_1");
  assert.deepEqual([background.width, background.height], [1920, 1080]);
  assert.equal(background.content, "data:image/png;base64,BBBB");
  assert.equal(jpeg.content, "data:image/jpeg;base64,AAAA");
  assert.equal(jpeg.style.objectFit, "fill");
  assert.equal(blank.content, "");
  assert.equal(converted.slides[0].backgroundColor, null, "only a solid background has a colour");
});

test("a deck with no slides converts to no slides, and a missing size is taken as 1920×1080", () => {
  const converted = convertPayloadToPresentation(
    { mode: "pptx", slide_width_px: 0, slide_height_px: 0, slides: [] },
    "/decks/.pptx",
  );
  assert.deepEqual(converted, { title: ".pptx", slideWidthPx: 1920, slideHeightPx: 1080, slides: [] });
});

// With python-pptx at hand, check the committed expectations are still exactly
// what the Electron importer produces.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "pptx");
const python = process.env.PRESENT_PPTX_PYTHON || "python3";
const hasPythonPptx = (() => {
  try {
    execFileSync(python, ["-c", "import pptx"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("the committed fixture expectations are the Electron importer's output", { skip: !hasPythonPptx }, async () => {
  const { importWithElectron } = await import("../scripts/pptx-expected.mjs");
  for (const name of readdirSync(fixtures).filter((entry) => entry.endsWith(".pptx"))) {
    const file = path.join(fixtures, name);
    const expected = JSON.parse(readFileSync(file.replace(/\.pptx$/, ".expected.json"), "utf8"));
    assert.deepEqual(JSON.parse(JSON.stringify(importWithElectron(file))), expected, name);
  }
});
