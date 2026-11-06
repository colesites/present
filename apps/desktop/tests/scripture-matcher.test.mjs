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

const {
  buildBibleMatcherIndex,
  matchSpokenScripture,
  matchRollingTranscript,
  DEFAULT_MATCHER_CONFIG,
} = load("../src/features/scripture/lib/scripture-matcher.ts");

const sampleVerses = [
  {
    pk: "kjv|gen|1|1",
    version: "kjv",
    bookId: "gen",
    bookName: "Genesis",
    chapter: 1,
    verse: 1,
    text: "In the beginning God created the heaven and the earth.",
  },
  {
    pk: "kjv|gen|1|2",
    version: "kjv",
    bookId: "gen",
    bookName: "Genesis",
    chapter: 1,
    verse: 2,
    text: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
  },
  {
    pk: "kjv|gen|1|3",
    version: "kjv",
    bookId: "gen",
    bookName: "Genesis",
    chapter: 1,
    verse: 3,
    text: "And God said, Let there be light: and there was light.",
  },
  {
    pk: "kjv|john|3|16",
    version: "kjv",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  },
  {
    pk: "kjv|rom|8|28",
    version: "kjv",
    bookId: "rom",
    bookName: "Romans",
    chapter: 8,
    verse: 28,
    text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
  },
  {
    pk: "kjv|psa|23|1",
    version: "kjv",
    bookId: "psa",
    bookName: "Psalms",
    chapter: 23,
    verse: 1,
    text: "The LORD is my shepherd; I shall not want.",
  },
  {
    pk: "kjv|psa|23|2",
    version: "kjv",
    bookId: "psa",
    bookName: "Psalms",
    chapter: 23,
    verse: 2,
    text: "He maketh me to lie down in green pastures: he leadeth me beside the still waters.",
  },
];

const index = buildBibleMatcherIndex(sampleVerses);

test("matches exact spoken verse", () => {
  const match = matchSpokenScripture(index, "For God so loved the world that He gave His only begotten Son");
  assert.ok(match, "should match John 3:16");
  assert.equal(match.verse.bookId, "john");
  assert.equal(match.verse.chapter, 3);
  assert.equal(match.verse.verse, 16);
  assert.ok(match.confidence >= 0.7);
});

test("matches across turn boundary pauses using rolling transcript", () => {
  // Pastor paused: Turn 0 was "In the beginning", Turn 1 was "God created the heaven and the earth"
  const rollingWords = [
    { text: "In", pos: 0, turn: 0 },
    { text: "the", pos: 1, turn: 0 },
    { text: "beginning", pos: 2, turn: 0 },
    { text: "God", pos: 3, turn: 1 },
    { text: "created", pos: 4, turn: 1 },
    { text: "the", pos: 5, turn: 1 },
    { text: "heaven", pos: 6, turn: 1 },
    { text: "and", pos: 7, turn: 1 },
    { text: "the", pos: 8, turn: 1 },
    { text: "earth", pos: 9, turn: 1 },
  ];

  const match = matchRollingTranscript(index, rollingWords);
  assert.ok(match, "should match Genesis 1:1 across pause");
  assert.equal(match.verse.bookId, "gen");
  assert.equal(match.verse.chapter, 1);
  assert.equal(match.verse.verse, 1);
});

test("applies sequential continuity bonus for adjacent verses", () => {
  // Genesis 1:1 is active on screen
  const activePassage = { bookId: "gen", chapter: 1, verse: 1 };
  const spoken = "the earth was without form and void and darkness was upon the face of the deep";

  const match = matchSpokenScripture(index, spoken, { activePassage });
  assert.ok(match, "should match Genesis 1:2");
  assert.equal(match.verse.verse, 2);
  assert.ok(match.continuity, "should flag sequential continuity");
});

test("tolerates speech errors and archaic equivalences", () => {
  // "heavens" instead of "heaven", "unto" vs "to"
  const spoken = "In the beginning God created the heavens and the earth";
  const match = matchSpokenScripture(index, spoken);
  assert.ok(match, "should match despite plural 'heavens'");
  assert.equal(match.verse.pk, "kjv|gen|1|1");
});

test("abstains on generic sermon commentary without distinctive matches", () => {
  const genericPreaching = "I want to share with everyone here this morning that God is so good to us every day and we must love one another";
  const match = matchSpokenScripture(index, genericPreaching);
  assert.equal(match, null, "should abstain on general sermon commentary");
});
