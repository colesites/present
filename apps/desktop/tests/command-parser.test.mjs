import assert from "node:assert";
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
    createContext({ exports: module.exports, module, require, Object, Array, Promise, Set, Map, setTimeout }),
  );
  return module.exports;
};

const parser = load("../src/features/scripture/lib/parser.ts");
const listening = load("../src/features/scripture/lib/listening.ts", { "./parser": parser });
const { parseExplicitCommand, parseSpokenNumber, normalizeSpeechErrors } = load(
  "../src/features/scripture/lib/command-parser.ts",
  {
    "./parser": parser,
    "./listening": listening,
  },
);

const books = [
  { id: "gen", name: "Genesis", chapters: 50 },
  { id: "hab", name: "Habakkuk", chapters: 3 },
  { id: "john", name: "John", chapters: 21 },
  { id: "rom", name: "Romans", chapters: 16 },
  { id: "1john", name: "1 John", chapters: 5 },
];

const versions = [
  { id: "kjv", code: "KJV", name: "King James Version" },
  { id: "niv", code: "NIV", name: "New International Version" },
  { id: "esv", code: "ESV", name: "English Standard Version" },
  { id: "amp", code: "AMP", name: "Amplified Bible" },
];

test("parses spoken numbers accurately", () => {
  assert.equal(parseSpokenNumber("12"), 12);
  assert.equal(parseSpokenNumber("twelve"), 12);
  assert.equal(parseSpokenNumber("twenty eight"), 28);
  assert.equal(parseSpokenNumber("twenty-eight"), 28);
  assert.equal(parseSpokenNumber("one hundred"), 100);
  assert.equal(parseSpokenNumber("three"), 3);
  assert.equal(parseSpokenNumber("not a number"), null);
});

test("normalizes speech recognition book name errors", () => {
  assert.equal(normalizeSpeechErrors("turn to have a cook 2"), "turn to Habakkuk 2");
  assert.equal(normalizeSpeechErrors("revelations 21"), "Revelation 21");
  assert.equal(normalizeSpeechErrors("psalm 23"), "Psalms 23");
  assert.equal(normalizeSpeechErrors("first john 1 9"), "1 John 1 9");
});

test("recognizes explicit next and previous verse commands", () => {
  const options = { books, versions, activePassage: null };

  assert.deepEqual(parseExplicitCommand("next verse", options), { type: "next_verse" });
  assert.deepEqual(parseExplicitCommand("Next verse please", options), { type: "next_verse" });
  assert.deepEqual(parseExplicitCommand("Go to next verse", options), { type: "next_verse" });
  assert.deepEqual(parseExplicitCommand("Skip to the next verse", options), { type: "next_verse" });

  assert.deepEqual(parseExplicitCommand("previous verse", options), { type: "previous_verse" });
  assert.deepEqual(parseExplicitCommand("prev verse", options), { type: "previous_verse" });
  assert.deepEqual(parseExplicitCommand("Go back a verse", options), { type: "previous_verse" });
  assert.deepEqual(parseExplicitCommand("Go to the last verse", options), { type: "previous_verse" });
});

test("recognizes explicit version switch commands", () => {
  const options = { books, versions, activePassage: null };

  assert.deepEqual(parseExplicitCommand("switch to NIV", options), {
    type: "switch_version",
    versionCode: "NIV",
  });
  assert.deepEqual(parseExplicitCommand("switch version to ESV", options), {
    type: "switch_version",
    versionCode: "ESV",
  });
  assert.deepEqual(parseExplicitCommand("read that in the Amplified", options), {
    type: "switch_version",
    versionCode: "AMP",
  });
  assert.deepEqual(parseExplicitCommand("give me KJV", options), {
    type: "switch_version",
    versionCode: "KJV",
  });
  assert.deepEqual(parseExplicitCommand("give me in KJV", options), {
    type: "switch_version",
    versionCode: "KJV",
  });
  assert.deepEqual(parseExplicitCommand("let's read in the King James Version", options), {
    type: "switch_version",
    versionCode: "KJV",
  });
});

test("rejects incidental version mentions as version commands", () => {
  const options = { books, versions, activePassage: null };

  assert.equal(parseExplicitCommand("I was reading the NIV yesterday", options), null);
  assert.equal(parseExplicitCommand("The NIV is a popular translation", options), null);
  assert.equal(parseExplicitCommand("In my personal study I use ESV", options), null);
});

test("recognizes explicit passage navigation commands", () => {
  const options = { books, versions, activePassage: null };

  const r1 = parseExplicitCommand("Turn to Romans 8:28", options);
  assert.ok(r1 && r1.type === "navigate_passage");
  assert.equal(r1.reference.book?.name, "Romans");
  assert.equal(r1.reference.chapter, 8);
  assert.equal(r1.reference.verseStart, 28);

  const r2 = parseExplicitCommand("Open your Bibles to Genesis chapter 1", options);
  assert.ok(r2 && r2.type === "navigate_passage");
  assert.equal(r2.reference.book?.name, "Genesis");
  assert.equal(r2.reference.chapter, 1);

  const r3 = parseExplicitCommand("Turn with me to have a cook 2:3", options);
  assert.ok(r3 && r3.type === "navigate_passage");
  assert.equal(r3.reference.book?.name, "Habakkuk");
  assert.equal(r3.reference.chapter, 2);
  assert.equal(r3.reference.verseStart, 3);
});

test("recognizes relative verse commands only with valid wording and active passage", () => {
  const activePassage = parser.parseReference("Romans 8:1", books);
  const options = { books, versions, activePassage };

  assert.deepEqual(parseExplicitCommand("show verse twelve", options), {
    type: "navigate_verse",
    verse: 12,
  });
  assert.deepEqual(parseExplicitCommand("look at verse 16", options), {
    type: "navigate_verse",
    verse: 16,
  });
  assert.deepEqual(parseExplicitCommand("read verse 28", options), {
    type: "navigate_verse",
    verse: 28,
  });

  // Bare number phrases without navigation keywords must NOT trigger verse navigation!
  assert.equal(parseExplicitCommand("there were twelve disciples", options), null);
  assert.equal(parseExplicitCommand("in three days I will rise", options), null);
});
