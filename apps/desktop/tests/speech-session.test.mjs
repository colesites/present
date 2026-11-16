import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/features/scripture/lib/speech-session.ts", import.meta.url),
  "utf8",
);
const module = { exports: {} };
new Script(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
).runInContext(createContext({ exports: module.exports, module }));
const { carriesOn, CARRY_ON_AFTER_MS, MOST_RESTARTS } = module.exports;

const fifteenMinutes = 15 * 60 * 1000;

test("listening carries on when a session's fifteen minutes are up", () => {
  assert.equal(
    carriesOn({ ours: true, stopping: false, ranForMs: fifteenMinutes, restarts: 0 }),
    true,
  );
});

test("it does not when the operator turned the microphone off", () => {
  assert.equal(
    carriesOn({ ours: true, stopping: true, ranForMs: fifteenMinutes, restarts: 0 }),
    false,
  );
});

test("nor for a session that could not really start, or after starting again and again", () => {
  assert.equal(
    carriesOn({ ours: true, stopping: false, ranForMs: CARRY_ON_AFTER_MS - 1, restarts: 0 }),
    false,
    "it would only fail again",
  );
  assert.equal(
    carriesOn({ ours: true, stopping: false, ranForMs: fifteenMinutes, restarts: MOST_RESTARTS }),
    false,
    "the operator is told instead",
  );
});

test("an earlier session's connection closing says nothing about the one listening now", () => {
  assert.equal(
    carriesOn({ ours: false, stopping: false, ranForMs: fifteenMinutes, restarts: 0 }),
    false,
  );
});
