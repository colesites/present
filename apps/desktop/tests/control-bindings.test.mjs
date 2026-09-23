import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// The module talks to Tauri; only the pure helpers are under test, so the
// import is stubbed.
const source = readFileSync(
  new URL("../src/renderer/tauri/control.ts", import.meta.url),
  "utf8",
).replace('import { invoke } from "@tauri-apps/api/core";', "const invoke = () => {};");

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
const context = createContext({ exports: module.exports, module, require: () => ({}) });
new Script(transpiled.outputText).runInContext(context);

const { actionFor, actionLabel, addMidiBinding, describeMidiMessage } = module.exports;

// The module runs in its own VM context, so its objects are not this realm's
// and would never compare equal.
const plain = (value) => JSON.parse(JSON.stringify(value));

const empty = {
  midi: { enabled: false, port: null, bindings: [] },
  osc: { enabled: false, port: 9000, bindings: [] },
};

test("a switch action binds as a toggle", () => {
  assert.deepEqual(plain(actionFor("text")), { action: "text", to: "toggle" });
  assert.deepEqual(plain(actionFor("nextSlide")), { action: "nextSlide" });
});

test("binding a button turns MIDI on", () => {
  const next = addMidiBinding(empty, { channel: 3, message: { kind: "note", note: 60 } }, "nextSlide");
  assert.equal(next.midi.enabled, true);
  assert.equal(next.midi.bindings.length, 1);
  assert.deepEqual(plain(next.midi.bindings[0]), {
    channel: 3,
    message: { kind: "note", note: 60 },
    action: "nextSlide",
  });
});

test("binding the same button again replaces what it did", () => {
  const learned = { channel: 3, message: { kind: "note", note: 60 } };
  const once = addMidiBinding(empty, learned, "nextSlide");
  const twice = addMidiBinding(once, learned, "previousSlide");
  assert.equal(twice.midi.bindings.length, 1);
  assert.equal(twice.midi.bindings[0].action, "previousSlide");
});

test("a different button is a second binding", () => {
  const once = addMidiBinding(empty, { channel: 1, message: { kind: "note", note: 60 } }, "nextSlide");
  const twice = addMidiBinding(once, { channel: 1, message: { kind: "note", note: 62 } }, "previousSlide");
  assert.equal(twice.midi.bindings.length, 2);
});

test("a binding reads as words", () => {
  assert.equal(
    describeMidiMessage({ channel: 2, message: { kind: "note", note: 60 }, action: "nextSlide" }),
    "Note 60 on channel 2",
  );
  assert.equal(
    describeMidiMessage({ channel: null, message: { kind: "controller", controller: 64 }, action: "clearMedia" }),
    "Control 64",
  );
  assert.equal(actionLabel({ action: "text", to: "toggle" }), "Show or hide the words");
  assert.equal(actionLabel({ action: "goToSlide", index: 4 }), "Go to slide 5");
});
