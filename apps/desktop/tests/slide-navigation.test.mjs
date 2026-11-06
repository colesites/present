import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const load = (path, modules = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const require = (name) => {
    const found = Object.entries(modules).find(([suffix]) => name === suffix);
    if (!found) throw new Error(`not loaded here: ${name}`);
    return found[1];
  };
  new Script(transpiled.outputText).runInContext(createContext({ exports: module.exports, module, require }));
  return module.exports;
};

const { stepFrom } = load("../src/renderer/shared/hooks/useAppNavigation.ts", {
  react: { useCallback: () => {}, useEffect: () => {}, useRef: () => ({}) },
});

const slides = (...hidden) => hidden.map((isHidden, index) => ({ index, slide: { text: `${index}`, hidden: isHidden } }));

test("next and previous pass over a deck's hidden slides", () => {
  const deck = slides(false, true, true, false, false, true);
  assert.equal(stepFrom(deck, 0, 1), 3);
  assert.equal(stepFrom(deck, 3, -1), 0);
  assert.equal(stepFrom(deck, 4, 1), 4, "only hidden slides after: stay");
  assert.equal(stepFrom(deck, 0, -1), 0, "nothing before: stay");
  assert.equal(stepFrom(slides(false, false), 0, 1), 1);
});
