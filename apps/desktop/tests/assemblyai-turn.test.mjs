import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/features/scripture/lib/assemblyai-turn.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Script(transpiled.outputText).runInContext(
  createContext({ exports: module.exports, module }),
);
// Through JSON: the module runs in its own VM context, so its objects are not
// this realm's and would never compare equal.
const readTurn = (turn, formatted) =>
  JSON.parse(JSON.stringify(module.exports.readTurn(turn, formatted)));

const words = (...texts) =>
  texts.map((text, index) => ({
    text,
    word_is_final: index < texts.length - 1,
  }));

test("the word still being said is shown, not only the finished ones", () => {
  const turn = {
    transcript: "turn with me to",
    words: words("turn", "with", "me", "to", "jo"),
  };
  assert.deepEqual(readTurn(turn, true), {
    text: "turn with me to jo",
    isFinal: false,
  });
});

test("with formatting on, only the formatted end of a turn is final", () => {
  const unformatted = {
    transcript: "romans 828",
    end_of_turn: true,
    words: words("romans", "828"),
  };
  const formatted = {
    transcript: "Romans 8:28.",
    end_of_turn: true,
    turn_is_formatted: true,
  };
  assert.deepEqual(readTurn(unformatted, true), {
    text: "romans 828",
    isFinal: false,
  });
  assert.deepEqual(readTurn(formatted, true), {
    text: "Romans 8:28.",
    isFinal: true,
  });
});

test("with formatting off, the end of a turn is final as before", () => {
  assert.deepEqual(
    readTurn({ transcript: "next verse", end_of_turn: true }, false),
    {
      text: "next verse",
      isFinal: true,
    },
  );
  assert.deepEqual(
    readTurn({ transcript: "", utterance: "Next verse." }, false),
    {
      text: "Next verse.",
      isFinal: true,
    },
  );
  assert.deepEqual(readTurn({ transcript: "", words: [] }, false), {
    text: "",
    isFinal: false,
  });
});

// Recorded from the service on 2026-11-03 with key terms set: every message of
// the turn, partials included, came marked formatted.
test("a partial marked formatted is still not final", () => {
  const partial = {
    transcript: "Turn with me to John",
    end_of_turn: false,
    turn_is_formatted: true,
    words: [
      ...words("Turn", "with", "me", "to", "John"),
      { text: "3:1", word_is_final: false },
    ],
  };
  assert.deepEqual(readTurn(partial, true), {
    text: "Turn with me to John 3:1",
    isFinal: false,
  });
  const end = {
    ...partial,
    transcript: "Turn with me to John 3:16.",
    end_of_turn: true,
  };
  assert.deepEqual(readTurn(end, true), {
    text: "Turn with me to John 3:16.",
    isFinal: true,
  });
});
