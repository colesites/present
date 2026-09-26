import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILT_IN_THEMES,
  SHADOW_PRESETS,
  applyLookToSlide,
  applyLookToSlides,
  backgroundIdFor,
  findBackgroundMedia,
  bandIdFor,
  isUntouchedOldSeed,
  layoutFrames,
  layoutOf,
  lookFromSlide,
  lookFromStoredTheme,
  normalizeFill,
  normalizeLook,
  parseShadowCss,
  shadowCss,
  styleForText,
  tierIncludes,
  tierOfLook,
  unstyleRichText,
  withSongTheme,
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
    if (tierOfLook(entry.look) === "advanced") assert.equal(entry.tier, "advanced", `${entry.id} uses a gradient`);
  }
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

test("every text option reaches the element style", () => {
  const style = styleForText(
    {
      ...theme("builtin:classic").text,
      fontWeight: "300",
      italic: true,
      underline: true,
      case: "title",
      opacity: 0.8,
      letterSpacing: 4,
      lineHeight: 1.5,
      shadow: { color: "#ff0000", blur: 12, x: 2, y: 4 },
    },
    0.5,
  );
  assert.equal(style.fontWeight, "300");
  assert.equal(style.fontStyle, "italic");
  assert.equal(style.fontUnderline, true);
  assert.equal(style.textDecoration, "underline");
  assert.equal(style.capitalization, "titleCase");
  assert.equal(style.opacity, 0.8);
  assert.equal(style.letterSpacing, 2, "scaled with the canvas");
  assert.equal(style.lineHeight, 1.5, "a multiple, so not scaled");
  assert.equal(style.shadow, "1px 2px 6px #ff0000");
});

test("shadows go to CSS and come back", () => {
  const shadow = { color: "rgba(0,0,0,0.5)", blur: 10, x: -2, y: 3 };
  assert.deepEqual(parseShadowCss(shadowCss(shadow)), shadow);
  assert.deepEqual(parseShadowCss(shadowCss(shadow, 0.5), 0.5), shadow);
  assert.equal(parseShadowCss("none"), null);
  assert.equal(parseShadowCss("inset nonsense"), null);
});

test("a theme with no background leaves the slide clear over its media", () => {
  const coloured = { ...lyricSlide("a"), backgroundColor: "#ff0000", useBackgroundColor: true };
  const slide = applyLookToSlide(coloured, theme("builtin:classic"), canvas);
  assert.equal(slide.useBackgroundColor, false);
  assert.equal(lookFromSlide(slide).background, null);
});

test("a gradient or mix background is a shape behind everything, with its first colour to fall back on", () => {
  const slide = applyLookToSlide(lyricSlide("a"), theme("builtin:dusk"), canvas);
  const [background] = slide.elements;
  assert.equal(background.id, backgroundIdFor("a"));
  assert.equal(background.type, "shape");
  assert.equal(background.width, 1920);
  assert.equal(background.style.fill.kind, "mix");
  assert.equal(background.style.backgroundColor, "#15161f");
  assert.equal(slide.backgroundColor, "#15161f");
  const plain = applyLookToSlide(slide, theme("builtin:paper"), canvas);
  assert.equal(plain.elements.length, 1, "the next theme takes it away");
});

test("an image or video background is the slide's media, behind a clear slide", () => {
  const video = { kind: "media", mediaId: "folder-1-Waves.mp4", name: "Waves.mp4", mediaType: "video" };
  const look = normalizeLook({ ...theme("builtin:classic"), background: video });
  assert.deepEqual(look.background, video);
  assert.equal(tierOfLook(look), "pro", "a Pro theme, not a Power one");
  const slide = applyLookToSlide({ ...lyricSlide("a"), backgroundColor: "#ff0000", useBackgroundColor: true }, look, canvas);
  assert.equal(slide.backgroundId, "folder-1-Waves.mp4");
  assert.equal(slide.useBackgroundColor, false, "a colour on the slide would cover the video");
  assert.equal(slide.elements.length, 1, "no shape is drawn for it");
  const plain = applyLookToSlide(slide, theme("builtin:paper"), canvas);
  assert.equal(plain.backgroundId, undefined, "the next theme takes it away");
  const read = lookFromSlide(slide, canvas, [{ id: "folder-1-Waves.mp4", name: "Waves.mp4", type: "video" }]);
  assert.deepEqual(read.background, video);
});

test("a background's media is found by id, or by file name on another computer", () => {
  const items = [
    { id: "home-Blue.png", name: "Blue.png" },
    { id: "church-Waves.mp4", name: "Waves.mp4" },
  ];
  assert.equal(findBackgroundMedia("church-Waves.mp4", items), items[1]);
  assert.equal(findBackgroundMedia("laptop-Waves.mp4", items), items[1], "another folder, the same file");
  assert.equal(findBackgroundMedia("laptop-Missing.mp4", items), null);
  assert.equal(findBackgroundMedia(null, items), null);
  assert.equal(normalizeLook({ ...theme("builtin:classic"), background: { kind: "media", mediaId: "" } }).background, null);
  assert.equal(normalizeLook({ ...theme("builtin:classic"), background: { kind: "media", mediaId: "x-Clip.MOV" } }).background.mediaType, "video");
});

test("a blank slide still gets the background, but no box", () => {
  const blank = applyLookToSlide({ id: "b", text: "", elements: [] }, theme("builtin:lower-third"), canvas);
  assert.deepEqual(blank.elements, []);
  const dusk = applyLookToSlide({ id: "b", text: "", elements: [] }, theme("builtin:dusk"), canvas);
  assert.equal(dusk.elements.length, 1);
  assert.equal(dusk.elements[0].id, backgroundIdFor("b"));
});

test("a lower third moves a lone text box down and puts a box behind it", () => {
  const slide = applyLookToSlide(lyricSlide("a"), theme("builtin:lower-third"), canvas);
  const [band, text] = slide.elements;
  assert.equal(band.id, bandIdFor("a"));
  assert.equal(band.type, "shape");
  assert.equal(band.y + band.height, 1080);
  assert.equal(band.style.fill.kind, "color");
  assert.ok(text.y > 1080 * 0.6, "the words sit in the lower third");
  assert.ok(text.y >= band.y, "inside the box");
});

test("the words and their box go wherever the theme puts them", () => {
  const custom = normalizeLook({
    ...theme("builtin:card"),
    frame: { x: 0.5, y: 0.1, width: 0.4, height: 0.3 },
    box: { frame: { x: 0.45, y: 0.05, width: 0.5, height: 0.4 }, fill: { kind: "color", color: "#000000" }, radius: 20 },
  });
  const slide = applyLookToSlide(lyricSlide("a"), custom, { width: 1280, height: 720 });
  const [box, text] = slide.elements;
  assert.deepEqual([text.x, text.y, text.width, text.height], [640, 72, 512, 216]);
  assert.deepEqual([box.x, box.y, box.width, box.height], [576, 36, 640, 288]);
  assert.equal(box.style.borderRadius, 13.33, "the radius scales with the canvas");
});

test("a theme's box and background are the same element on every slide, so transitions leave them still", () => {
  const [one, two] = applyLookToSlides([lyricSlide("a", "Amazing grace"), lyricSlide("b", "How sweet")], {
    ...theme("builtin:dusk"),
    box: theme("builtin:lower-third").box,
  }, canvas);
  assert.deepEqual(one.elements.slice(0, 2), two.elements.slice(0, 2), "the background and the box, identical");
  assert.notEqual(one.elements[2].id, two.elements[2].id, "the words are each slide's own");
  const older = { ...lyricSlide("c"), elements: [{ id: "c__theme-band", type: "shape", x: 0, y: 0, width: 1, height: 1 }, ...lyricSlide("c").elements] };
  const replaced = applyLookToSlide(older, theme("builtin:classic"), canvas);
  assert.equal(replaced.elements.length, 1, "an older slide's box is found and taken away too");
});

test("applying another theme replaces the box rather than stacking them", () => {
  const lower = applyLookToSlide(lyricSlide("a"), theme("builtin:lower-third"), canvas);
  const upper = applyLookToSlide(lower, theme("builtin:upper-third"), canvas);
  assert.equal(upper.elements.filter((element) => element.id.endsWith("__theme-band")).length, 1);
  assert.equal(upper.elements[0].y, 0);
  const full = applyLookToSlide(upper, theme("builtin:classic"), canvas);
  assert.equal(full.elements.length, 1);
  assert.equal(full.elements[0].height, Math.round(1080 * 0.84 * 100) / 100);
});

test("a designed slide with several text boxes keeps them where they are, with no box", () => {
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
  assert.equal(applyLookToSlide(designed, theme("builtin:lower-third"), canvas).elements.length, 3);
});

test("an old slide with words but no boxes gets a themed box", () => {
  const slide = applyLookToSlide({ id: "o", text: "Holy, holy" }, theme("builtin:scripture"), canvas);
  assert.equal(slide.elements.length, 1);
  assert.equal(slide.elements[0].content, "Holy, holy");
  assert.equal(slide.elements[0].style.fontFamily, "Georgia");
  assert.equal(slide.elements[0].style.textAlign, "left");
});

test("only the chosen slide changes when one is named, by its place in the song", () => {
  const slides = [lyricSlide("a"), lyricSlide("b"), { text: "no id" }];
  const next = applyLookToSlides(slides, theme("builtin:paper"), canvas, { onlySlideIndex: 1 });
  assert.equal(next[0], slides[0]);
  assert.equal(next[2], slides[2]);
  assert.equal(next[1].elements[0].style.color, "#17181c");
  const idless = applyLookToSlides(slides, theme("builtin:paper"), canvas, { onlySlideIndex: 2 });
  assert.equal(idless[2].elements[0].style.color, "#17181c", "a slide without an id can be chosen too");
});

test("sizes follow a smaller canvas", () => {
  const small = { width: 1280, height: 720 };
  const slide = applyLookToSlide(lyricSlide("a"), theme("builtin:outline"), small);
  assert.equal(slide.elements[0].style.fontSize, Math.round(80 * (2 / 3)));
  assert.equal(slide.elements[0].style.strokeWidth, Math.round(5 * (2 / 3) * 100) / 100);
  assert.equal(lookFromSlide(slide, small).text.fontSize, 80);
});

test("run-level fonts, colours and paragraph line heights are cleared so the theme shows", () => {
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
          paragraphs: [{ alignment: "left", lineHeight: 3, runs: [{ text: "Hi", fontFamily: "Papyrus", color: "#123456", underline: true }] }],
        },
      },
    ],
  };
  const [paragraph] = applyLookToSlide(slide, theme("builtin:classic"), canvas).elements[0].textBody.paragraphs;
  assert.deepEqual(paragraph.runs, [{ text: "Hi", underline: true }]);
  assert.equal(paragraph.alignment, "center");
  assert.equal(paragraph.lineHeight, undefined);
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

test("a theme from the first version of looks reads as the same look", () => {
  const old = normalizeLook({
    text: { fontFamily: "Arial", fontSize: 58, fontWeight: "700", uppercase: true, color: "#ffffff", shadow: "strong", align: "center" },
    background: "#000000",
    layout: "lower-third",
    band: { color: "rgba(0,0,0,0.62)" },
  });
  assert.equal(old.version, 2);
  assert.equal(old.text.case, "upper");
  assert.deepEqual(old.text.shadow, SHADOW_PRESETS.strong);
  assert.deepEqual(old.frame, layoutFrames("lower-third").frame);
  assert.deepEqual(old.box.frame, layoutFrames("lower-third").box);
  assert.deepEqual(old.box.fill, { kind: "color", color: "rgba(0,0,0,0.62)" });
  assert.deepEqual(old.background, { kind: "color", color: "#000000" });
  assert.equal(layoutOf(old.frame), "lower-third");
  const unset = normalizeLook({ text: {}, layout: "full", background: null });
  assert.deepEqual(unset.text.shadow, SHADOW_PRESETS.soft, "the first version's soft shadow was the default");
  assert.equal(unset.box, null);
});

test("stored looks are checked, not trusted", () => {
  const look = normalizeLook({
    version: 2,
    text: {
      fontSize: 9000,
      color: "javascript:alert(1)",
      fontWeight: "bold",
      shadow: { color: "url(x)", blur: 999, x: -999, y: "3" },
      outline: { width: -3 },
      letterSpacing: 500,
      lineHeight: 0,
      opacity: 0,
      case: "shouting",
    },
    frame: { x: 5, y: -5, width: 0, height: 9 },
    box: { frame: {}, fill: { kind: "gradient", from: "red", to: "#123" }, radius: -4 },
    background: { kind: "image", url: "http://evil" },
  });
  assert.equal(look.text.fontSize, 300);
  assert.equal(look.text.color, "#ffffff");
  assert.equal(look.text.fontWeight, "700");
  assert.deepEqual(look.text.shadow, { color: "rgba(0,0,0,0.55)", blur: 80, x: -60, y: 3 });
  assert.equal(look.text.outline.width, 0.5);
  assert.equal(look.text.letterSpacing, 60);
  assert.equal(look.text.lineHeight, 0.7);
  assert.equal(look.text.opacity, 0.1);
  assert.equal(look.text.case, "none");
  assert.deepEqual(look.frame, { x: 0.95, y: -0.2, width: 0.05, height: 1 });
  assert.equal(look.box.fill.from, "#1e1b4b");
  assert.equal(look.box.radius, 0);
  assert.equal(look.background, null, "a kind of fill this build doesn't know is none");
});

test("fills are checked too", () => {
  assert.deepEqual(normalizeFill("#fff"), { kind: "color", color: "#fff" });
  assert.equal(normalizeFill("tomato"), null);
  const mix = normalizeFill({ kind: "mix", base: "#000", spots: Array.from({ length: 9 }, () => ({ color: "#f00", x: 9, y: -9, size: 0 })) });
  assert.equal(mix.spots.length, 4);
  assert.deepEqual(mix.spots[0], { color: "#f00", x: 1.5, y: -0.5, size: 0.05 });
});

test("a theme from the old Themes modal becomes a look", () => {
  const look = lookFromStoredTheme({
    name: "Golden Ticket",
    style: { fontFamily: "Georgia", fontSize: 64, fontWeight: "700", color: "#fbbf24", shadow: shadowCss(SHADOW_PRESETS.strong), textAlign: "center" },
    backgroundColor: "#1c1917",
  });
  assert.equal(look.text.fontFamily, "Georgia");
  assert.equal(look.text.color, "#fbbf24");
  assert.deepEqual(look.text.shadow, SHADOW_PRESETS.strong);
  assert.deepEqual(look.background, { kind: "color", color: "#1c1917" });
});

test("the old modal's untouched copies are hidden, edited ones are not", () => {
  assert.equal(isUntouchedOldSeed({ name: "Vivid", createdAt: 1000, updatedAt: 1000 }), true);
  assert.equal(isUntouchedOldSeed({ name: "Vivid", createdAt: 1000, updatedAt: 90_000 }), false);
  assert.equal(isUntouchedOldSeed({ name: "Sunday", createdAt: 1000, updatedAt: 1000 }), false);
  assert.equal(isUntouchedOldSeed({ name: "Vivid", look: {}, createdAt: 1, updatedAt: 1 }), false);
});

test("gradients anywhere in a look make it Power's", () => {
  assert.equal(tierOfLook(theme("builtin:classic")), "pro");
  assert.equal(tierOfLook(theme("builtin:aurora")), "advanced");
  assert.equal(tierOfLook(theme("builtin:dusk")), "advanced");
  const box = normalizeLook({ ...theme("builtin:card"), box: { ...theme("builtin:card").box, fill: { kind: "gradient", from: "#000", to: "#fff", angle: 0 } } });
  assert.equal(tierOfLook(box), "advanced");
});

test("plan tiers include the themes below them", () => {
  assert.equal(tierIncludes("basic", "basic"), true);
  assert.equal(tierIncludes("basic", "pro"), false);
  assert.equal(tierIncludes("custom", "pro"), true);
  assert.equal(tierIncludes("custom", "advanced"), false);
  assert.equal(tierIncludes("advanced", "advanced"), true);
  assert.equal(tierIncludes("nonsense", "basic"), true);
});

test("a song's recorded theme goes back on slides rebuilt from its lyrics", () => {
  const rebuilt = [lyricSlide("x")];
  const [slide] = withSongTheme(rebuilt, { look: theme("builtin:lower-third") }, canvas);
  assert.equal(slide.elements[0].id, bandIdFor("x"));
  assert.equal(withSongTheme(rebuilt, null, canvas), rebuilt);
});
