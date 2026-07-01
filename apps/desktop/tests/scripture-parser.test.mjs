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

const { parseReference } = module.exports;

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
