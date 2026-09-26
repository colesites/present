import assert from "node:assert/strict";
import test from "node:test";

import { referenceText, stepLabel, stepPassage } from "../src/features/scripture/lib/step-reference.mjs";

// John: 21 chapters; chapter 2 has 25 verses, 3 has 36, 1 has 51.
const john = { name: "John", chapters: 21 };
const verses = { 1: 51, 2: 25, 3: 36, 21: 25 };
const versesIn = (chapter) => verses[chapter] ?? (chapter >= 1 && chapter <= 21 ? 30 : 0);
const passage = (chapter, verseStart = null, verseEnd = null) => ({ book: john, chapter, verseStart, verseEnd, versionCode: "ESV" });

test("a single verse steps one verse either way", () => {
  assert.deepEqual(stepPassage(passage(2, 4), "next", versesIn), { chapter: 2, verseStart: 5, verseEnd: null });
  assert.deepEqual(stepPassage(passage(2, 4), "previous", versesIn), { chapter: 2, verseStart: 3, verseEnd: null });
});

test("at the end of a chapter it goes on into the next, and back", () => {
  assert.deepEqual(stepPassage(passage(2, 25), "next", versesIn), { chapter: 3, verseStart: 1, verseEnd: null });
  assert.deepEqual(stepPassage(passage(3, 1), "previous", versesIn), { chapter: 2, verseStart: 25, verseEnd: null });
});

test("it stops at the ends of the book", () => {
  assert.equal(stepPassage(passage(1, 1), "previous", versesIn), null);
  assert.equal(stepPassage(passage(21, 25), "next", versesIn), null);
  assert.equal(stepPassage(passage(21), "next", versesIn), null);
});

test("a range steps by its own length, and stops short at a chapter's end", () => {
  assert.deepEqual(stepPassage(passage(3, 16, 18), "next", versesIn), { chapter: 3, verseStart: 19, verseEnd: 21 });
  assert.deepEqual(stepPassage(passage(3, 16, 18), "previous", versesIn), { chapter: 3, verseStart: 13, verseEnd: 15 });
  assert.deepEqual(stepPassage(passage(2, 23, 24), "next", versesIn), { chapter: 2, verseStart: 25, verseEnd: null });
  assert.deepEqual(stepPassage(passage(2, 24, 25), "next", versesIn), { chapter: 3, verseStart: 1, verseEnd: 2 });
  assert.deepEqual(stepPassage(passage(3, 1, 3), "previous", versesIn), { chapter: 2, verseStart: 23, verseEnd: 25 });
});

test("a whole chapter steps a chapter", () => {
  assert.deepEqual(stepPassage(passage(2), "next", versesIn), { chapter: 3, verseStart: null, verseEnd: null });
  assert.deepEqual(stepPassage(passage(2), "previous", versesIn), { chapter: 1, verseStart: null, verseEnd: null });
});

test("a step reads as a reference and a short label", () => {
  assert.equal(referenceText(john, { chapter: 2, verseStart: 5, verseEnd: null }, "ESV"), "John 2:5 ESV");
  assert.equal(referenceText(john, { chapter: 3, verseStart: 1, verseEnd: 2 }), "John 3:1-2");
  assert.equal(stepLabel({ chapter: 2, verseStart: 3, verseEnd: null }), "2:3");
  assert.equal(stepLabel({ chapter: 4, verseStart: null, verseEnd: null }), "Chapter 4");
});
