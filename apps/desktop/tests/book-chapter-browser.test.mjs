import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const load = (path) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  });
  const module = { exports: {} };
  const mockReact = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useMemo: (fn) => fn(),
    useEffect: () => {},
    Fragment: "Fragment",
  };
  const require = (name) => {
    if (name === "react") return mockReact;
    if (name.includes("utils")) return { cn: (...args) => args.filter(Boolean).join(" ") };
    if (name.includes("canonical-verses")) return { getCanonicalVerseCount: () => 27 };
    if (name.includes("canonical-verse-counts.json")) {
      const parsed = JSON.parse(readFileSync(new URL("../src/features/scripture/lib/canonical-verse-counts.json", import.meta.url), "utf8"));
      return { ...parsed, default: parsed };
    }
    if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
    throw new Error(`not loaded here: ${name}`);
  };
  new Script(transpiled.outputText).runInContext(
    createContext({ exports: module.exports, module, require, Object, Array, RegExp, Set, Map }),
  );
  return module.exports;
};

const { CANONICAL_BOOKS, BookChapterBrowser } = load(
  "../src/features/scripture/components/BookChapterBrowser.tsx",
);

test("BookChapterBrowser: canonical books list has 66 books", () => {
  assert.equal(CANONICAL_BOOKS.length, 66);
  const ot = CANONICAL_BOOKS.filter((b) => b.testament === "OT");
  const nt = CANONICAL_BOOKS.filter((b) => b.testament === "NT");
  assert.equal(ot.length, 39, "Old Testament should have 39 books");
  assert.equal(nt.length, 27, "New Testament should have 27 books");
});

test("BookChapterBrowser: accurate canonical chapter counts", () => {
  const gen = CANONICAL_BOOKS.find((b) => b.name === "Genesis");
  assert.equal(gen?.chapters, 50);

  const ps = CANONICAL_BOOKS.find((b) => b.name === "Psalms");
  assert.equal(ps?.chapters, 150);

  const john = CANONICAL_BOOKS.find((b) => b.name === "John");
  assert.equal(john?.chapters, 21);

  const rom = CANONICAL_BOOKS.find((b) => b.name === "Romans");
  assert.equal(rom?.chapters, 16);

  const obad = CANONICAL_BOOKS.find((b) => b.name === "Obadiah");
  assert.equal(obad?.chapters, 1);

  const rev = CANONICAL_BOOKS.find((b) => b.name === "Revelation");
  assert.equal(rev?.chapters, 22);
});

test("BookChapterBrowser: renders without errors", () => {
  let selected = null;
  const element = BookChapterBrowser({
    activeBookName: "Romans",
    activeChapter: 8,
    activeVerse: 28,
    onSelectPassage: (book, ch, v) => {
      selected = `${book} ${ch}:${v}`;
    },
  });
  assert.ok(element, "Should return rendered element");
});

test("BookChapterBrowser: canonical verse counts helper works for major chapters", () => {
  const { getCanonicalVerseCount } = load(
    "../src/features/scripture/lib/canonical-verses.ts",
  );
  assert.equal(getCanonicalVerseCount("Genesis", 1), 31);
  assert.equal(getCanonicalVerseCount("Genesis", 17), 27);
  assert.equal(getCanonicalVerseCount("John", 3), 36);
  assert.equal(getCanonicalVerseCount("Romans", 8), 39);
});
