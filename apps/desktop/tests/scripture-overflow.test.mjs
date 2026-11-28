import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const load = (path, modules = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const require = (name) => {
    const found = Object.entries(modules).find(([suffix]) => name.endsWith(suffix));
    if (!found) throw new Error(`not loaded here: ${name}`);
    return found[1];
  };
  new Script(transpiled.outputText).runInContext(
    createContext({ exports: module.exports, module, require, Map, Set, RegExp }),
  );
  return module.exports;
};

const lib = "../src/features/scripture/lib/";
const overflow = load(`${lib}overflow.ts`);
const parser = load(`${lib}parser.ts`);
const listening = load(`${lib}listening.ts`, { "./parser": parser });
const slides = load(`${lib}slides.ts`, { "./listening": listening, "./overflow": overflow });

const { splitVerse, fitsAt, autoFitFor, normalizeScriptureOverflow, DEFAULT_SCRIPTURE_OVERFLOW } = overflow;

// Every character half the size wide: near enough a proportional font.
const widthOf = (text, fontSize) => text.length * fontSize * 0.5;
// A 1920×1080 slide's verse box, as the settings make it.
const box = { width: 1920, height: 760, lineHeight: 1.2 };
const settings = (change) => ({ ...DEFAULT_SCRIPTURE_OVERFLOW, ...change });

const PSALM_119_176 =
  "I have gone astray like a lost sheep; seek thy servant; for I do not forget thy commandments.";
const ESTHER_8_9 =
  "Then were the king's scribes called at that time in the third month, that is, the month Sivan, on the three and twentieth day thereof; and it was written according to all that Mordecai commanded unto the Jews, and to the lieutenants, and the deputies and rulers of the provinces which are from India unto Ethiopia, an hundred twenty and seven provinces, unto every province according to the writing thereof, and unto every people after their language, and to the Jews according to their writing, and according to their language.";

const join = (parts) => parts.join(" ").replace(/\s+/g, " ").trim();

test("a verse that fits is one slide, in every mode", () => {
  for (const mode of overflow.SCRIPTURE_OVERFLOW_MODES) {
    assert.deepEqual([...splitVerse(PSALM_119_176, 96, settings({ mode }), box, widthOf).parts], [PSALM_119_176], mode);
  }
});

test("shrink, fit and fixed never split, however long the verse", () => {
  for (const mode of ["shrink", "fit", "fixed"]) {
    assert.equal(splitVerse(ESTHER_8_9, 96, settings({ mode }), box, widthOf).parts.length, 1, mode);
  }
});

// At 56 Esther 8:9 fits this box shrunk: it is split once it would be smaller than 80.
test("smart shrinks a long verse to its smallest size, then splits it at its sentences", () => {
  const parts = splitVerse(ESTHER_8_9, 96, settings({ mode: "smart", minFontSize: 80 }), box, widthOf).parts;
  assert.ok(parts.length >= 2, `split into ${parts.length}`);
  assert.equal(join(parts), join([ESTHER_8_9]), "nothing lost, nothing added");
  for (const part of parts) {
    assert.ok(fitsAt(part, 80, box, widthOf), `fits at 80: ${part}`);
    assert.match(part, /[,;.]$/, `ends at a clause: ${part}`);
  }
});

test("split keeps the size chosen: more slides than smart", () => {
  const smart = splitVerse(ESTHER_8_9, 96, settings({ mode: "smart", minFontSize: 80 }), box, widthOf).parts;
  const split = splitVerse(ESTHER_8_9, 96, settings({ mode: "split" }), box, widthOf).parts;
  assert.ok(split.length > smart.length, `${split.length} > ${smart.length}`);
  for (const part of split) assert.ok(fitsAt(part, 96, box, widthOf), part);
});

test("split by words is even: no slide with a word or two on its own", () => {
  const parts = splitVerse(ESTHER_8_9, 96, settings({ mode: "split", splitBy: "words" }), box, widthOf).parts;
  const counts = parts.map((part) => part.split(/\s+/).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 3, `even: ${counts}`);
  assert.equal(join(parts), join([ESTHER_8_9]));
});

test("split by lines keeps every slide within its lines", () => {
  const parts = splitVerse(ESTHER_8_9, 72, settings({ mode: "split", splitBy: "lines", maxLines: 3 }), box, widthOf).parts;
  for (const part of parts) {
    assert.ok(overflow.linesAt(part, 72, box, widthOf).lines <= 3, part);
  }
});

test("a verse's box is told how to size its words", () => {
  assert.equal(autoFitFor("smart"), "shrink");
  assert.equal(autoFitFor("shrink"), "shrink");
  assert.equal(autoFitFor("split"), "shrink");
  assert.equal(autoFitFor("fit"), "grow");
  assert.equal(autoFitFor("fixed"), "none");
});

test("a setting read back from storage is whole and in range", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeScriptureOverflow(null))), JSON.parse(JSON.stringify(DEFAULT_SCRIPTURE_OVERFLOW)));
  const read = normalizeScriptureOverflow({ mode: "nonsense", minFontSize: 2, maxLines: 99, compactFooter: false });
  assert.equal(read.mode, "smart");
  assert.equal(read.minFontSize, 12);
  assert.equal(read.maxLines, 20);
  assert.equal(read.compactFooter, false);
});

const verseSlide = (content) => ({
  id: "scripture:kjv|est|8|9",
  verse: 9,
  content,
  label: "Esther 8:9 (KJV)",
  footer: "Esther 8:9 (KJV)",
  elements: [
    {
      id: "v",
      type: "text",
      contentRole: "scriptureVerse",
      x: 0,
      y: 0,
      width: 1920,
      height: 760,
      content,
      style: { fontSize: 96, fontFamily: "Inter" },
    },
    { id: "f", type: "text", contentRole: "scriptureFooter", x: 0, y: 760, width: 1920, height: 320, content: "Esther 8:9 (KJV)", style: { fontSize: 70 } },
  ],
});

test("a verse slide splits into parts, each with the reference and which part it is", () => {
  const parts = slides.splitScriptureSlide(verseSlide(`9. ${ESTHER_8_9}`), settings({ mode: "smart", minFontSize: 80 }), widthOf);
  assert.ok(parts.length >= 2);
  assert.equal(parts[0].id, "scripture:kjv|est|8|9", "the first keeps the verse's id");
  assert.equal(parts[1].id, "scripture:kjv|est|8|9~2");
  assert.equal(parts[1].footer, `Esther 8:9 (KJV) · 2/${parts.length}`);
  assert.equal(parts[1].elements[0].content, parts[1].content, "its verse box says its words");
  assert.equal(parts[1].elements[1].content, parts[1].footer, "and its footer box the reference");
  assert.equal(parts[0].elements[0].autoFit, "shrink");
  assert.equal(slides.getActiveScriptureVersePk(parts[1].id), "kjv|est|8|9", "a part is still the verse");
  // The words before each part, as the Bible agent counts the verse's words.
  const words = listening.readingWords(ESTHER_8_9);
  assert.equal(parts[0].part.fromWord, 0);
  assert.equal(parts[1].part.fromWord, listening.readingWords(parts[0].content.replace(/^9\. /, "")).length);
  assert.ok(parts.at(-1).part.fromWord < words.length);
});

test("the slide being read is the part holding the word", () => {
  const parts = slides.splitScriptureSlide(verseSlide(`9. ${ESTHER_8_9}`), settings({ mode: "smart", minFontSize: 80 }), widthOf);
  assert.equal(slides.scriptureSlideAt(parts, 9, 0).id, parts[0].id);
  assert.equal(slides.scriptureSlideAt(parts, 9, parts[1].part.fromWord).id, parts[1].id);
  assert.equal(slides.scriptureSlideAt(parts, 9, 10_000).id, parts.at(-1).id);
  assert.equal(slides.scriptureSlideAt(parts, 10, 0), null);
});

test("split parts put back together are the verse, to be split again", () => {
  const whole = verseSlide(`9. ${ESTHER_8_9}`);
  const parts = slides.splitScriptureSlide(whole, settings({ mode: "split" }), widthOf);
  const [joined] = slides.joinScriptureParts(parts);
  assert.equal(slides.joinScriptureParts(parts).length, 1);
  assert.equal(joined.id, whole.id);
  assert.equal(joined.label, whole.label);
  assert.equal(joined.footer, whole.footer);
  assert.equal(joined.content.replace(/\s+/g, " "), whole.content.replace(/\s+/g, " "));
  assert.equal(joined.part, undefined);
});
