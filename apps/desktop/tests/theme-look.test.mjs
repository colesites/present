import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILT_IN_THEMES,
  SHADOWS,
  applyLookToSlide,
  applyLookToSlides,
  bandIdFor,
  isUntouchedOldSeed,
  lookFromSlide,
  lookFromStoredTheme,
  normalizeLook,
  styleForText,
  tierIncludes,
  unstyleRichText,
} from "../src/features/themes/theme-look.mjs";

const canvas = { width: 1920, height: 1080 };
const theme = (id) => BUILT_IN_THEMES.find((entry) => entry.id === id).look;

const lyricSlide = (id, text = "Amazing grace") => ({
  id,
  text,
  elements: [
    {
      id: `${id}_text_0`,
      type: "text",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      content: text,
      style: { fontFamily: "Comic Sans MS", fontSize: 40, color: "#ff0000", strokeWidth: 6, strokeColor: "#00ff00" },
    },
  ],
});

test("every built-in theme is already a whole, normalized look", () => {
  const ids = new Set();
  for (const entry of BUILT_IN_THEMES) {
    assert.ok(!ids.has(entry.id), `${entry.id} is listed once`);
    ids.add(entry.id);
    assert.deepEqual(normalizeLook(entry.look), entry.look, entry.id);
    assert.ok(["basic", "pro", "advanced"].includes(entry.tier), entry.id);
  }
  assert.ok(BUILT_IN_THEMES.some((entry) => entry.tier === "basic"));
});

test("a theme replaces the words' style, including an old outline", () => {
  const [slide] = applyLookToSlides([lyricSlide("a")], theme("builtin:paper"), canvas);
  const style = slide.elements[0].style;
  assert.equal(style.fontFamily, "Arial");
  assert.equal(style.color, "#17181c");
  assert.equal(style.strokeWidth, 0);
  assert.equal(style.shadow, "none");
  assert.equal(style.textFillMode, "solid");
  assert.equal(slide.backgroundColor, "#f4f1ea");
  assert.equal(slide.useBackgroundColor, true);
});

test("a theme with no background leaves the slide clear over its media", () => {
  const coloured = { ...lyricSlide("a"), backgroundColor: "#ff0000", useBackgroundColor: true };
  const slide = applyLookToSlide(coloured, theme("builtin:classic"), canvas);
  assert.equal(slide.useBackgroundColor, false);
  assert.equal(lookFromSlide(slide).background, null);
});

test("a lower third moves a lone text box down and puts a band behind it", () => {
  const slide = applyLookToSlide(lyricSlide("a"), theme("builtin:lower-third"), canvas);
  const [band, text] = slide.elements;
  assert.equal(band.id, bandIdFor("a"));
  assert.equal(band.type, "shape");
  assert.equal(band.y + band.height, 1080);
  assert.ok(text.y > 1080 * 0.6, "the words sit in the lower third");
  assert.ok(text.y >= band.y, "inside the band");
});

test("applying another theme replaces the band rather than stacking them", () => {
  const lower = applyLookToSlide(lyricSlide("a"), theme("builtin:lower-third"), canvas);
  const upper = applyLookToSlide(lower, theme("builtin:upper-third"), canvas);
  assert.equal(upper.elements.filter((element) => element.id.endsWith("__theme-band")).length, 1);
  assert.equal(upper.elements[0].y, 0);
  const full = applyLookToSlide(upper, theme("builtin:classic"), canvas);
  assert.equal(full.elements.length, 1);
  assert.equal(full.elements[0].height, Math.round(1080 * 0.84 * 100) / 100);
});

test("a designed slide with several text boxes keeps them where they are", () => {
  const designed = {
    id: "d",
    text: "",
    elements: [
      { id: "t1", type: "text", x: 10, y: 20, width: 300, height: 100, content: "Title" },
      { id: "t2", type: "text", x: 10, y: 400, width: 300, height: 100, content: "Body" },
      { id: "img", type: "image", x: 0, y: 0, width: 50, height: 50, content: "x.png" },
    ],
  };
  const slide = applyLookToSlide(designed, theme("builtin:bold"), canvas);
  assert.deepEqual(
    slide.elements.map(({ id, x, y }) => [id, x, y]),
    [
      ["t1", 10, 20],
      ["t2", 10, 400],
      ["img", 0, 0],
    ],
  );
  assert.equal(slide.elements[0].style.capitalization, "uppercase");
  assert.equal(slide.elements[2].style, undefined, "images are left alone");
  const lower = applyLookToSlide(designed, theme("builtin:lower-third"), canvas);
  assert.equal(lower.elements.length, 3, "and no band goes behind boxes that stay put");
});

test("a blank slide gets the background but no empty band", () => {
  const blank = applyLookToSlide({ id: "b", text: "", elements: [] }, theme("builtin:lower-third"), canvas);
  assert.deepEqual(blank.elements, []);
});

test("an old slide with words but no boxes gets a themed box", () => {
  const slide = applyLookToSlide({ id: "o", text: "Holy, holy" }, theme("builtin:scripture"), canvas);
  assert.equal(slide.elements.length, 1);
  assert.equal(slide.elements[0].content, "Holy, holy");
  assert.equal(slide.elements[0].style.fontFamily, "Georgia");
  assert.equal(slide.elements[0].style.textAlign, "left");
});

test("only the chosen slide changes when one is named", () => {
  const slides = [lyricSlide("a"), lyricSlide("b")];
  const next = applyLookToSlides(slides, theme("builtin:paper"), canvas, { onlySlideId: "b" });
  assert.equal(next[0], slides[0]);
  assert.equal(next[1].elements[0].style.color, "#17181c");
});

test("sizes follow a smaller canvas", () => {
  const small = { width: 1280, height: 720 };
  const slide = applyLookToSlide(lyricSlide("a"), theme("builtin:outline"), small);
  assert.equal(slide.elements[0].style.fontSize, Math.round(80 * (2 / 3)));
  assert.ok(Math.abs(slide.elements[0].style.strokeWidth - 5 * (2 / 3)) < 1e-9);
  assert.equal(lookFromSlide(slide, small).text.fontSize, 80);
});

test("run-level fonts and colours are cleared so the theme shows", () => {
  const slide = {
    id: "r",
    text: "",
    elements: [
      {
        id: "t",
        type: "text",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        content: "Hi",
        textBody: {
          paragraphs: [{ alignment: "left", runs: [{ text: "Hi", fontFamily: "Papyrus", color: "#123456", underline: true }] }],
        },
      },
    ],
  };
  const [paragraph] = applyLookToSlide(slide, theme("builtin:classic"), canvas).elements[0].textBody.paragraphs;
  assert.deepEqual(paragraph.runs, [{ text: "Hi", underline: true }]);
  assert.equal(paragraph.alignment, "center");
});

test("rich text keeps its emphasis and loses its typed fonts", () => {
  assert.equal(
    unstyleRichText('<b>Great</b> is <font color="#f00" face="Papyrus">thy</font> <span style="font-size: 30px">faithfulness</span><br>'),
    "<b>Great</b> is thy faithfulness<br>",
  );
  assert.equal(unstyleRichText('<i style="color:red">Lord</i>'), "<i>Lord</i>");
});

test("a scripture reference line stays smaller than its verse", () => {
  const slide = {
    id: "s",
    text: "",
    elements: [
      { id: "v", type: "text", contentRole: "scriptureVerse", x: 0, y: 0, width: 1920, height: 900, content: "In the beginning" },
      { id: "f", type: "text", contentRole: "scriptureFooter", x: 0, y: 900, width: 1920, height: 180, content: "Genesis 1:1" },
    ],
  };
  const [verse, footer] = applyLookToSlide(slide, theme("builtin:hymnal"), canvas).elements;
  assert.ok(footer.style.fontSize < verse.style.fontSize);
  assert.equal(footer.y, 900, "two boxes keep their places");
});

test("a slide's look reads back as the theme that made it", () => {
  for (const entry of BUILT_IN_THEMES) {
    const slide = applyLookToSlide(lyricSlide("a"), entry.look, canvas);
    assert.deepEqual(lookFromSlide(slide), entry.look, entry.id);
  }
});

test("stored looks are checked, not trusted", () => {
  const look = normalizeLook({
    text: { fontSize: 9000, color: "javascript:alert(1)", fontWeight: "bold", shadow: "huge", outline: { width: -3 } },
    background: "url(evil)",
    layout: "sideways",
    band: { color: "#123" },
  });
  assert.equal(look.text.fontSize, 240);
  assert.equal(look.text.color, "#ffffff");
  assert.equal(look.text.fontWeight, "700");
  assert.equal(look.text.shadow, "soft");
  assert.equal(look.text.outline.width, 1);
  assert.equal(look.background, "#000000");
  assert.equal(look.layout, "full");
  assert.equal(look.band, null, "a band only goes with a third");
});

test("a theme from the old Themes modal becomes a look", () => {
  const look = lookFromStoredTheme({
    name: "Golden Ticket",
    style: { fontFamily: "Georgia", fontSize: 64, fontWeight: "700", color: "#fbbf24", shadow: SHADOWS.strong, textAlign: "center" },
    backgroundColor: "#1c1917",
  });
  assert.equal(look.text.fontFamily, "Georgia");
  assert.equal(look.text.color, "#fbbf24");
  assert.equal(look.text.shadow, "strong");
  assert.equal(look.background, "#1c1917");
  assert.deepEqual(styleForText(look.text).shadow, SHADOWS.strong);
});

test("the old modal's untouched copies are hidden, edited ones are not", () => {
  assert.equal(isUntouchedOldSeed({ name: "Vivid", createdAt: 1000, updatedAt: 1000 }), true);
  assert.equal(isUntouchedOldSeed({ name: "Vivid", createdAt: 1000, updatedAt: 90_000 }), false);
  assert.equal(isUntouchedOldSeed({ name: "Sunday", createdAt: 1000, updatedAt: 1000 }), false);
  assert.equal(isUntouchedOldSeed({ name: "Vivid", look: {}, createdAt: 1, updatedAt: 1 }), false);
});

test("plan tiers include the themes below them", () => {
  assert.equal(tierIncludes("basic", "basic"), true);
  assert.equal(tierIncludes("basic", "pro"), false);
  assert.equal(tierIncludes("custom", "pro"), true);
  assert.equal(tierIncludes("custom", "advanced"), false);
  assert.equal(tierIncludes("advanced", "advanced"), true);
  assert.equal(tierIncludes("nonsense", "basic"), true);
});
