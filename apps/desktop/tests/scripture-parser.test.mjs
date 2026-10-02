import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const parserSource = readFileSync(
  new URL("../src/features/scripture/lib/parser.ts", import.meta.url),
  "utf8",
);

const transpiled = ts.transpileModule(parserSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const module = { exports: {} };
const context = createContext({
  exports: module.exports,
  module,
});
new Script(transpiled.outputText).runInContext(context);

const { findReferenceInSentence, findRelativeReference, parseReference } = module.exports;

const table = JSON.parse(
  readFileSync(new URL("./fixtures/scripture-references.json", import.meta.url), "utf8"),
);

// The rules both parsers answer to. `services/scripture.rs` is checked against
// this same table, so the Rust core and the panel read a reference the same
// way — including the quirks, like a chapter 0 reported as a missing chapter.
test("parses every reference in the shared table the same way", () => {
  for (const expected of table.cases) {
    const parsed = parseReference(expected.input, table.books);
    // Through JSON: the parser runs in its own VM context, so its arrays are
    // not this realm's and would never compare equal.
    const actual = JSON.parse(
      JSON.stringify({
        input: expected.input,
        book: parsed.book?.id ?? null,
        chapter: parsed.chapter,
        verseStart: parsed.verseStart,
        verseEnd: parsed.verseEnd,
        versionCode: parsed.versionCode,
        errors: [...parsed.errors],
      }),
    );
    assert.deepEqual(actual, expected);
  }
});

const books = [
  {
    pk: "nkjv|gen",
    version: "nkjv",
    id: "gen",
    name: "Genesis",
    abbreviation: "Gen",
    chapters: 50,
  },
  {
    pk: "nkjv|1jn",
    version: "nkjv",
    id: "1jn",
    name: "1 John",
    abbreviation: "1 Jn",
    chapters: 5,
  },
];

test("parses explicit scripture references", () => {
  const parsed = parseReference("Genesis 1:2", books);
  assert.equal(parsed.book?.name, "Genesis");
  assert.equal(parsed.chapter, 1);
  assert.equal(parsed.verseStart, 2);
  assert.equal(parsed.errors.length, 0);
});

test("parses speech references without colon punctuation", () => {
  const parsed = parseReference("Genesis 1 2", books);
  assert.equal(parsed.book?.name, "Genesis");
  assert.equal(parsed.chapter, 1);
  assert.equal(parsed.verseStart, 2);
  assert.equal(parsed.errors.length, 0);
});

test("extracts scripture references from natural speech", () => {
  const parsed = parseReference("please open to Genesis chapter one verse two", books);
  assert.equal(parsed.book?.name, "Genesis");
  assert.equal(parsed.chapter, 1);
  assert.equal(parsed.verseStart, 2);
  assert.equal(parsed.errors.length, 0);
});

test("normalizes ordinal book names in speech", () => {
  const parsed = parseReference("turn to first John one two", books);
  assert.equal(parsed.book?.name, "1 John");
  assert.equal(parsed.chapter, 1);
  assert.equal(parsed.verseStart, 2);
  assert.equal(parsed.errors.length, 0);
});

// The Bible agent's Find it: what AssemblyAI heard, read here with no model.
test("finds a reference said in the middle of a sentence", () => {
  const read = (sentence) => {
    const found = findReferenceInSentence(sentence, table.books);
    return found
      ? [found.book?.id ?? null, found.chapter, found.verseStart, found.verseEnd]
      : null;
  };
  assert.deepEqual(read("turn with me to John chapter 3 verse 16 this morning"), ["jhn", 3, 16, null]);
  assert.deepEqual(read("Turn with me to John chapter three verse sixteen."), ["jhn", 3, 16, null]);
  assert.deepEqual(read("let us read first John 1 9 together"), ["1jn", 1, 9, null]);
  assert.deepEqual(
    read("my ex used to read Psalm 23 verses 1 to 4"),
    ["psa", 23, 1, 4],
    "a short name early in the sentence does not hide the reference after it",
  );
  assert.equal(read("and that is all for this morning"), null);
  assert.equal(read("John"), null, "a book with no chapter is not a reference");
});

test("a verse or chapter said alone moves within the passage that is open", () => {
  const john = table.books.find((book) => book.id === "jhn");
  const open = { book: john, chapter: 3, verseStart: 16, verseEnd: null, versionCode: null, errors: [] };
  const read = (sentence) => {
    const found = findRelativeReference(sentence, open);
    return found ? [found.book?.id ?? null, found.chapter, found.verseStart, found.verseEnd] : null;
  };
  assert.deepEqual(read("now look at verse eighteen"), ["jhn", 3, 18, null]);
  assert.deepEqual(read("verses 17 to 19"), ["jhn", 3, 17, 19]);
  assert.deepEqual(read("turn over to chapter four"), ["jhn", 4, null, null]);
  assert.deepEqual(read("chapter four verse two"), ["jhn", 4, 2, null]);
  assert.equal(read("we will have lunch at 3:30"), null, "no verse or chapter was said");
  assert.equal(read("chapter ninety"), null, "John has 21");
  assert.equal(
    findRelativeReference("verse 18", { book: null, chapter: null, verseStart: null, verseEnd: null, versionCode: null, errors: [] }),
    null,
    "nothing open to move within",
  );
});
