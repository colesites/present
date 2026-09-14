import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  customFontFace,
  dedupeFontFaces,
  describeMacFontFamily,
  finishSystemFontFaces,
  finishSystemFontFamilies,
  getFontFileMimeType,
  inferFontMetaFromFileName,
  isSupportedFontFile,
  normalizeFontStyleMeta,
  normalizeFontWeightMeta,
  plainSystemFontFaces,
  standardizeFontListName,
  systemFontFaces,
  systemFontFamilies,
  uniqueFontFileName,
} from "../src/shared/lib/font-catalog.mjs";

// What Electron's five font channels return, pinned before the Rust port
// (`src-tauri/src/services/fonts.rs` carries the same cases).

const weight = (raw) => {
  const meta = normalizeFontWeightMeta(raw);
  return `${meta.weight} ${meta.weightLabel}`;
};

test("a numeric weight is clamped to 100-900 and rounded to the hundred", () => {
  assert.equal(weight("700"), "700 Bold");
  assert.equal(weight("650"), "700 Bold", "half rounds up");
  assert.equal(weight("150"), "200 Extra Light");
  assert.equal(weight("1000"), "900 Black");
  assert.equal(weight("50"), "100 Thin");
  assert.equal(weight("99999999999999999999"), "900 Black");
  assert.equal(weight(" 400 "), "400 Regular", "trimmed first");
});

test("a named weight takes the first hint whose whole word it contains", () => {
  assert.equal(weight("bold"), "700 Bold");
  assert.equal(weight("Semi-Bold"), "600 Semibold");
  assert.equal(weight("ultralight"), "200 Extra Light");
  assert.equal(weight("heavy"), "800 Extra Bold");
  assert.equal(weight("black"), "900 Black");
  // "bold" is listed before "extra bold", and is a whole word here…
  assert.equal(weight("Extra Bold"), "700 Bold");
  // …but not inside "ExtraBold", so the later hint gets it.
  assert.equal(weight("ExtraBold"), "800 Extra Bold");
});

test("an unrecognised weight is 400, labelled with its own name in title case", () => {
  assert.equal(weight("foo_bar-baz"), "400 Foo Bar Baz");
  assert.equal(weight("élan"), "400 éLan", "only ASCII letters count as word characters");
  assert.equal(weight(""), "400 Regular");
  assert.equal(weight(undefined), "400 Regular");
  assert.equal(weight(null), "400 Regular");
});

test("a style is italic or oblique by whole word, otherwise normal with its own label", () => {
  assert.deepEqual(normalizeFontStyleMeta("italic"), { style: "italic", styleLabel: "Italic" });
  assert.deepEqual(normalizeFontStyleMeta("Oblique"), { style: "oblique", styleLabel: "Oblique" });
  assert.deepEqual(normalizeFontStyleMeta("BoldItalic"), {
    style: "normal",
    styleLabel: "BoldItalic",
  });
  assert.deepEqual(normalizeFontStyleMeta("slanted-ish"), {
    style: "normal",
    styleLabel: "Slanted Ish",
  });
  assert.deepEqual(normalizeFontStyleMeta(""), { style: "normal", styleLabel: "Normal" });
});

test("an installed font is named from its file name", () => {
  const meta = (fileName) => {
    const inferred = inferFontMetaFromFileName(fileName);
    return [inferred.familyName, inferred.weight, inferred.weightLabel, inferred.style, inferred.styleLabel];
  };
  assert.deepEqual(meta("Open_Sans-Bold.otf"), ["Open Sans", "700", "Bold", "normal", "Open Sans Bold"]);
  assert.deepEqual(meta("Lato-Black.woff2"), ["Lato", "900", "Black", "normal", "Lato Black"]);
  assert.deepEqual(meta("Roboto Condensed Light.ttf"), ["Roboto Condensed", "300", "Light", "normal", "Roboto Condensed Light"]);
  assert.deepEqual(meta("Inter-ExtraBold.woff"), ["Inter", "800", "Extra Bold", "normal", "Inter ExtraBold"]);
  assert.deepEqual(meta("Lato-Italic.ttf"), ["Lato", "400", "Lato Italic", "italic", "Italic"]);
  // Run together, neither weight nor style is a whole word.
  assert.deepEqual(meta("Montserrat-SemiBoldItalic.ttf"), [
    "Montserrat SemiBoldItalic",
    "400",
    "Montserrat SemiBoldItalic",
    "normal",
    "Montserrat SemiBoldItalic",
  ]);
  assert.deepEqual(meta("Bold.ttf"), ["Bold", "700", "Bold", "normal", "Bold"], "a family made only of a weight keeps it");
  assert.deepEqual(meta(".ttf"), ["Custom Font", "400", "Regular", "normal", "Normal"]);
  assert.deepEqual(meta("a.b.ttf"), ["a.b", "400", "A.B", "normal", "A.B"], "only the last extension goes");
});

test("the MIME type follows the extension, and anything else is TrueType", () => {
  assert.equal(getFontFileMimeType("a.OTF"), "font/otf");
  assert.equal(getFontFileMimeType("a.woff2"), "font/woff2");
  assert.equal(getFontFileMimeType("a.woff"), "font/woff");
  assert.equal(getFontFileMimeType("a.ttf"), "font/ttf");
  assert.equal(getFontFileMimeType("a.txt"), "font/ttf");
});

test("only ttf, otf, woff and woff2 files are fonts, whatever the case", () => {
  assert.equal(isSupportedFontFile("Lato.TTF"), true);
  assert.equal(isSupportedFontFile("Lato.woff2"), true);
  assert.equal(isSupportedFontFile("Lato.eot"), false);
  assert.equal(isSupportedFontFile(".ttf"), false, "a hidden file has no extension");
  assert.equal(isSupportedFontFile("ttf"), false);
});

test("an installed copy never overwrites one already there", () => {
  const taken = new Set(["Lato.ttf", "Lato 1.ttf"]);
  assert.equal(uniqueFontFileName("Lato.ttf", (name) => name === "Lato.ttf"), "Lato 1.ttf");
  assert.equal(uniqueFontFileName("Lato.ttf", (name) => taken.has(name)), "Lato 2.ttf");
  assert.equal(uniqueFontFileName("  Lato  .otf", () => false), "Lato.otf", "the stem is trimmed");
  assert.equal(uniqueFontFileName(" .ttf", () => false), "Custom Font.ttf");
  assert.equal(uniqueFontFileName("noext", () => false), "noext.ttf");
});

test("an installed font is listed with its bytes as a data URL", () => {
  assert.deepEqual(customFontFace("Lato-BoldItalic.ttf", "/fonts/Lato-BoldItalic.ttf", "QUJD"), {
    familyName: "Lato BoldItalic",
    postScriptName: "Lato-BoldItalic",
    weight: "400",
    weightLabel: "Lato BoldItalic",
    style: "normal",
    styleLabel: "Lato BoldItalic",
    width: "",
    monospace: false,
    source: "custom",
    fileName: "Lato-BoldItalic.ttf",
    filePath: "/fonts/Lato-BoldItalic.ttf",
    dataUrl: "data:font/ttf;base64,QUJD",
  });
});

test("faces are deduplicated and sorted by one joined, lower-cased string", () => {
  const face = (familyName, postScriptName, weightValue, style) => ({
    source: "system",
    familyName,
    postScriptName,
    weight: weightValue,
    style,
  });
  const sorted = dedupeFontFaces([
    face("Zed", "Zed", "400", "normal"),
    face("arial", "Arial-Bold", "700", "normal"),
    face("Arial", "Arial", "400", "normal"),
    face("Arial", "Arial", "400", "normal"),
    face("Arial", "Arial-Italic", "400", "italic"),
    face("A,b", "x", "400", "normal"),
    face("A", "x", "1000", "normal"),
    face("Éclat", "Eclat", "400", "normal"),
  ]).map((entry) => `${entry.familyName}/${entry.postScriptName}/${entry.weight}/${entry.style}`);
  assert.deepEqual(sorted, [
    // "a,1000,…" before "a,b,…": the digit sorts before the letter.
    "A/x/1000/normal",
    "A,b/x/400/normal",
    "Arial/Arial-Italic/400/italic",
    "Arial/Arial/400/normal",
    "arial/Arial-Bold/700/normal",
    "Zed/Zed/400/normal",
    // By code unit, not by locale: "é" is after "z".
    "Éclat/Eclat/400/normal",
  ]);
});

test("font-list drops iconfont and unquotes names", () => {
  assert.equal(standardizeFontListName('"Quoted Name"'), "Quoted Name");
  assert.equal(standardizeFontListName("\\u559c\\u9e4aX"), "喜鹊X");
  assert.equal(standardizeFontListName('"'), "", "one quote is both ends");
  assert.deepEqual(systemFontFamilies(["b", "A", "a", "iconfont", "", "  Spaced  ", "Spaced", '"Q"']), [
    "a",
    "A",
    "b",
    "Q",
    "Spaced",
  ]);
});

test("system faces use the helper's guesses, and fall back to 400 Regular per family", () => {
  assert.deepEqual(
    systemFontFaces([
      { familyName: "Helvetica Neue", postScriptName: "HelveticaNeue", weight: "regular", style: "normal", width: "normal", monospace: false },
      { familyName: "iconfont", postScriptName: "x" },
      { familyName: "Menlo", postScriptName: "Menlo-Regular", weight: "regular", style: "normal", width: "normal", monospace: true },
      { familyName: "Arial Black", postScriptName: "Arial-Black", weight: "heavy", style: "normal", width: "normal", monospace: false },
    ]).map((face) => [face.familyName, face.weight, face.weightLabel, face.width, face.monospace]),
    [
      ["Arial Black", "800", "Extra Bold", "normal", false],
      ["Helvetica Neue", "400", "Regular", "normal", false],
      ["Menlo", "400", "Regular", "normal", true],
    ],
  );
  assert.deepEqual(plainSystemFontFaces(["Inter"]), [
    {
      familyName: "Inter",
      postScriptName: "Inter",
      weight: "400",
      weightLabel: "Regular",
      style: "normal",
      styleLabel: "Normal",
      width: "",
      monospace: false,
      source: "system",
    },
  ]);
});

test("the helper's guesses from a PostScript name", () => {
  const guess = (postScriptName) => {
    const described = describeMacFontFamily("F", postScriptName);
    return [described.weight, described.style, described.width, described.monospace];
  };
  assert.deepEqual(guess("HelveticaNeue-Thin"), ["ultralight", "normal", "normal", false]);
  assert.deepEqual(guess("Avenir-LightOblique"), ["light", "italic", "normal", false]);
  assert.deepEqual(guess("Futura-CondensedMedium"), ["medium", "normal", "condensed", false]);
  assert.deepEqual(guess("Georgia-BoldItalic"), ["bold", "italic", "normal", false]);
  assert.deepEqual(guess("Arial-Black"), ["heavy", "normal", "normal", false]);
  assert.deepEqual(guess("SourceSansPro-Regular"), ["regular", "normal", "normal", true], "'source' counts as monospace");
  assert.deepEqual(guess("Semibold"), ["semibold", "normal", "normal", false]);
  assert.deepEqual(guess("Extended"), ["regular", "normal", "expanded", false]);
});

// On a Mac with font-list installed, check all of the above against the real
// thing: the helper binaries and the library that post-processes them.
const require = createRequire(import.meta.url);
const fontListDirectory = (() => {
  try {
    return dirname(require.resolve("font-list"));
  } catch {
    return null;
  }
})();
const helpers = fontListDirectory && join(fontListDirectory, "libs", "darwin");
const onMacWithHelpers =
  process.platform === "darwin" && helpers && existsSync(join(helpers, "fontlist2"));

test("on this Mac, the port matches font-list's helpers and library exactly", { skip: !onMacWithHelpers }, async () => {
  const fontList = require("font-list");

  const lines = execFileSync(join(helpers, "fontlist"), { maxBuffer: 10 * 1024 * 1024 })
    .toString()
    .split("\n");
  assert.deepEqual(
    systemFontFamilies(lines),
    finishSystemFontFamilies(await fontList.getFonts({ disableQuoting: true })),
  );

  const entries = JSON.parse(
    execFileSync(join(helpers, "fontlist2"), { maxBuffer: 10 * 1024 * 1024 }).toString(),
  );
  assert.ok(entries.length > 20, "the helper listed this machine's fonts");
  for (const entry of entries) {
    assert.deepEqual(describeMacFontFamily(entry.familyName, entry.postScriptName), entry);
  }
  assert.deepEqual(
    systemFontFaces(entries),
    finishSystemFontFaces(await fontList.getFonts2({ disableQuoting: true })),
  );
});
