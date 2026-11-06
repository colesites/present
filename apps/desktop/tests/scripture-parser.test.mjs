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

// The streaming transcription writes "John three sixteen" as "john 316" until
// a turn ends. A number that is no chapter of the book, and splits into a
// chapter and verse it has exactly one way, is read that way at once.
test("a chapter and verse heard as one number are read apart where only one split fits", () => {
  const books = [
    { pk: "kjv|jhn", version: "kjv", id: "jhn", name: "John", chapters: 21 },
    { pk: "kjv|rom", version: "kjv", id: "rom", name: "Romans", chapters: 16 },
    { pk: "kjv|mat", version: "kjv", id: "mat", name: "Matthew", chapters: 28 },
    { pk: "kjv|isa", version: "kjv", id: "isa", name: "Isaiah", chapters: 66 },
    { pk: "kjv|1co", version: "kjv", id: "1co", name: "1 Corinthians", chapters: 16 },
    { pk: "kjv|gen", version: "kjv", id: "gen", name: "Genesis", chapters: 50 },
    { pk: "kjv|psa", version: "kjv", id: "psa", name: "Psalms", chapters: 150 },
  ];
  const read = (input) => {
    const parsed = parseReference(input, books);
    return parsed.errors.length ? null : `${parsed.book?.name} ${parsed.chapter}:${parsed.verseStart}`;
  };
  assert.equal(read("john 316"), "John 3:16");
  assert.equal(read("romans 828"), "Romans 8:28");
  assert.equal(read("matthew 2819"), "Matthew 28:19");
  assert.equal(read("isaiah 4031"), "Isaiah 40:31", "never a verse with a leading 0");
  assert.equal(read("1 corinthians 1313"), "1 Corinthians 13:13");
  assert.equal(read("john 31"), "John 3:1", "two digits that are no chapter");
  assert.equal(read("genesis 111"), null, "1:11 or 11:1: left for the formatted turn");
  assert.equal(read("psalms 23"), "Psalms 23:null", "a chapter the book has stays a chapter");
  assert.equal(
    findReferenceInSentence("and romans 828 says all things work together", books)?.verseStart,
    28,
  );

  // Verse counts settle what chapter counts cannot: Psalm 11 has 7 verses and
  // Psalm 1 has 6, so "psalm 1191" can only be 119:1.
  assert.equal(read("psalms 1191"), null, "119:1, 11:91 and 1:191 all fit 150 chapters");
  module.exports.knowVerseCounts((book, chapter) =>
    book === "Psalms" ? { 1: 6, 2: 12, 11: 7, 23: 6, 119: 176 }[chapter] ?? null : null,
  );
  assert.equal(read("psalms 1191"), "Psalms 119:1");
  assert.equal(read("psalms 234"), "Psalms 23:4");
  module.exports.knowVerseCounts(() => null);
});
