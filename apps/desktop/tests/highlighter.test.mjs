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
    Fragment: "Fragment",
  };
  const require = (name) => {
    if (name === "react") return mockReact;
    throw new Error(`not loaded here: ${name}`);
  };
  new Script(transpiled.outputText).runInContext(
    createContext({ exports: module.exports, module, require, Object, Array, RegExp, Set, Map }),
  );
  return module.exports;
};

const { getHighlightSegments, highlightText } = load(
  "../src/features/scripture/lib/highlighter.tsx",
);

test("highlighter: returns single non-match segment when query is empty", () => {
  const text = "In the beginning God created the heaven and the earth.";
  const segs1 = getHighlightSegments(text, "");
  assert.equal(segs1.length, 1);
  assert.equal(segs1[0].isMatch, false);
  assert.equal(segs1[0].text, text);

  const segs2 = getHighlightSegments(text, null);
  assert.equal(segs2.length, 1);
  assert.equal(segs2[0].isMatch, false);

  const res = highlightText(text, "");
  assert.equal(res, text);
});

test("highlighter: highlights exact matching phrase", () => {
  const text = "In the beginning God created the heaven and the earth.";
  const segs = getHighlightSegments(text, "created the");

  assert.equal(segs.length, 3);
  assert.equal(segs[0].text, "In the beginning God ");
  assert.equal(segs[0].isMatch, false);
  assert.equal(segs[1].text, "created the");
  assert.equal(segs[1].isMatch, true);
  assert.equal(segs[2].text, " heaven and the earth.");
  assert.equal(segs[2].isMatch, false);
});

test("highlighter: case-insensitive phrase matching", () => {
  const text = "In the beginning God created the heaven and the earth.";
  const segs = getHighlightSegments(text, "CREATED THE");

  const match = segs.find((s) => s.isMatch);
  assert.ok(match, "Should match despite case difference");
  assert.equal(match.text, "created the");
});

test("highlighter: highlights multiple words when phrase is broken", () => {
  const text = "In the beginning God created the heaven and the earth.";
  const segs = getHighlightSegments(text, "beginning heaven");

  const matches = segs.filter((s) => s.isMatch);
  assert.equal(matches.length, 2, "Should highlight both words");
  assert.equal(matches[0].text, "beginning");
  assert.equal(matches[1].text, "heaven");
});

test("highlighter: safe against special regex characters in query", () => {
  const text = "For God so loved the world (John 3:16)?";
  const segs = getHighlightSegments(text, "(John 3:16)?");

  const match = segs.find((s) => s.isMatch);
  assert.ok(match, "Should safely escape parentheses and question marks");
  assert.equal(match.text, "(John 3:16)?");
});

test("highlighter: outputs yellow mark tag with highlightText", () => {
  const text = "In the beginning God created the heaven and the earth.";
  const element = highlightText(text, "created the");

  // React fragment containing children
  assert.ok(element && element.props);
  const children = Array.isArray(element.props.children?.[0])
    ? element.props.children[0]
    : element.props.children;
  const mark = children.find((c) => c && c.type === "mark");
  assert.ok(mark, "Should produce a mark tag");
  assert.equal(mark.props.children[0], "created the");
  assert.ok(mark.props.className.includes("bg-yellow-300"));
});
