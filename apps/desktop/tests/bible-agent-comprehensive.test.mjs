import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const load = (path, modules = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const require = (name) => {
    const found = Object.entries(modules).find(([suffix]) => name.endsWith(suffix));
    if (!found) throw new Error(`not loaded here: ${name}`);
    return found[1];
  };
  new Script(transpiled.outputText).runInContext(
    createContext({ exports: module.exports, module, require, Promise, Set, Map, setTimeout }),
  );
  return module.exports;
};

const parser = load("../src/features/scripture/lib/parser.ts");
const listening = load("../src/features/scripture/lib/listening.ts", { "./parser": parser });
const transcriptBuffer = load("../src/features/scripture/lib/transcript-buffer.ts");
const commandParser = load("../src/features/scripture/lib/command-parser.ts", {
  "./parser": parser,
  "./listening": listening,
});
const stepReference = load("../src/features/scripture/lib/step-reference.mjs");
const { createHeardScripture } = load("../src/features/scripture/lib/heard-scripture.ts", {
  "./parser": parser,
  "./listening": listening,
  "./transcript-buffer": transcriptBuffer,
  "./command-parser": commandParser,
  "./step-reference.mjs": stepReference,
});
const {
  buildBibleMatcherIndex,
  matchSpokenScripture,
} = load("../src/features/scripture/lib/scripture-matcher.ts");

const books = [
  ["genesis", "Genesis", 50],
  ["psalms", "Psalms", 150],
  ["habakkuk", "Habakkuk", 3],
  ["1samuel", "1 Samuel", 31],
  ["luke", "Luke", 24],
  ["jude", "Jude", 1],
  ["revelation", "Revelation", 22],
  ["john", "John", 21],
  ["romans", "Romans", 16],
  ["1john", "1 John", 5],
].map(([id, name, chapters]) => ({ pk: `kjv|${id}`, version: "kjv", id, name, chapters }));

const versions = [
  { id: "kjv", code: "KJV", name: "King James Version" },
  { id: "niv", code: "NIV", name: "New International Version" },
  { id: "esv", code: "ESV", name: "English Standard Version" },
  { id: "amp", code: "AMP", name: "Amplified Bible" },
];

const settle = () => new Promise((resolve) => setImmediate(resolve));

const createTestTab = ({
  onHeard = "show",
  defaultVersion = "KJV",
  model = () => null,
  quotes = () => null,
  bibles = versions,
  catalog = [],
  install = async () => false,
  chapters = {},
} = {}) => {
  const tab = {
    box: "",
    chosen: defaultVersion,
    screen: [],
    asked: [],
    open: true,
  };
  const settings = () => ({
    enabled: tab.open,
    onHeard,
    addToService: true,
    books,
    versions: bibles,
    catalog: catalog.filter((offered) => !bibles.some((version) => version.code === offered.code)),
    install: (code) => install(code, tab),
    chosenVersionCode: tab.chosen,
    openPassage: () => parser.parseReference(tab.box, books),
    fill: (lookup) => {
      tab.box = lookup;
    },
    show: (lookup, { addToService }) => {
      tab.screen.push(addToService ? lookup : `${lookup} (not added again)`);
    },
    chooseVersion: (code) => {
      tab.chosen = code;
      agent.update(settings());
    },
    understand: async (heard, earlier, open) => {
      tab.asked.push(heard);
      tab.earlier = earlier;
      const answer = await model(heard, open, earlier);
      return answer
        ? {
            reference: parser.parseReference(answer.reference, books),
            confidence: answer.confidence ?? (answer.sure ? 1 : 0.7),
            mayProject: Boolean(answer.sure),
            story: Boolean(answer.story),
            intent: answer.intent,
          }
        : null;
    },
    findQuotedVerse: async (input) => quotes(input),
    versionCodeOf: (id) => bibles.find((version) => version.id === id)?.code ?? "KJV",
    readChapter: async (book, chapter) => chapters[`${book.id} ${chapter}`] ?? [],
  });
  const agent = createHeardScripture(settings());
  tab.stopListening = () => agent.forget();
  tab.refresh = () => agent.update(settings());
  tab.hear = async (words, isFinal = false) => {
    agent.hear(words, isFinal);
    await settle();
  };
  tab.hearEvent = async (event) => {
    agent.hear(event);
    await settle();
  };
  return tab;
};

// =========================================================================
// 1. TRANSCRIPT CONTINUITY ACROSS PAUSES
// =========================================================================
test("Transcript Continuity: Pastor pauses mid-verse across AssemblyAI turn boundaries", async () => {
  const corpus = [
    {
      pk: "kjv|gen|1|1",
      bookId: "genesis",
      chapter: 1,
      verse: 1,
      text: "In the beginning God created the heaven and the earth.",
    },
  ];
  const matcherIndex = buildBibleMatcherIndex(corpus);

  // Turn 0: "In the beginning" followed by pause (end_of_turn: true)
  const tab = createTestTab({
    quotes: ({ query }) => {
      const words = query.split(/\s+/).filter(Boolean).map((text, i) => ({
        text,
        norm: text.toLowerCase().replace(/[^a-z0-9]/g, ""),
        pos: i,
        arrivedAtMs: Date.now(),
        turn: 0,
        isFinal: true,
      }));
      const match = matchSpokenScripture(matcherIndex, words);
      if (match) {
        return {
          pk: match.verse.pk,
          bookId: match.verse.bookId,
          chapter: match.verse.chapter,
          verse: match.verse.verse,
          version: "kjv",
        };
      }
      return null;
    },
  });

  // Turn 0: "In the beginning"
  await tab.hearEvent({
    session: 1,
    turn: 0,
    transcript: "In the beginning",
    endOfTurn: true,
    receivedAt: Date.now(),
  });
  // After just "In the beginning", matcher abstains because text is too incomplete
  assert.deepEqual(tab.screen, [], "abstains on incomplete phrase 'In the beginning'");

  // Turn 1: Pastor pauses, then says "God created the heaven and the earth."
  await tab.hearEvent({
    session: 1,
    turn: 1,
    transcript: "God created the heaven and the earth.",
    endOfTurn: true,
    receivedAt: Date.now() + 1000,
  });

  // Rolling transcript buffer seamlessly connects Turn 0 and Turn 1:
  // "In the beginning God created the heaven and the earth." matches Genesis 1:1!
  assert.deepEqual(tab.screen, ["Genesis 1:1 KJV"], "Genesis 1:1 projected across turn boundary pause");
});

// =========================================================================
// 2. HARD TRANSLATION LOCK INVARIANT
// =========================================================================
test("Translation Invariant: Pastor quotes another version without switching active Bible", async () => {
  const tab = createTestTab({
    defaultVersion: "KJV",
    quotes: ({ query }) => {
      // Query closely matches NIV wording of Romans 8:28
      if (/all things God works for the good/i.test(query)) {
        return {
          pk: "niv|romans|8|28",
          bookId: "romans",
          chapter: 8,
          verse: 28,
          version: "niv",
        };
      }
      return null;
    },
  });

  // Pastor quotes NIV wording while KJV is selected in the church
  await tab.hear("And we know that in all things God works for the good of those who love him.", true);

  // HARD INVARIANT: Active translation NEVER changes because text matched another translation!
  assert.equal(tab.chosen, "KJV", "chosen Bible remains KJV");
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"], "passage is projected in church's active translation (KJV)");
});

// =========================================================================
// 3. EXPLICIT VERSION CHANGE COMMANDS
// =========================================================================
test("Explicit Version Switch: Explicit commands switch translation, similarity scores cannot", async () => {
  const tab = createTestTab({
    defaultVersion: "KJV",
  });

  await tab.hear("Somebody shout hallelujah. Romans 8:28.");
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"]);

  // Explicit command: "Switch to NIV."
  await tab.hear("Switch to NIV.", true);
  assert.equal(tab.chosen, "NIV", "explicit command switches chosen version to NIV");
  assert.equal(tab.screen.at(-1), "Romans 8:28 NIV (not added again)", "in-view passage updated to NIV on screen");

  // Explicit command with scripture reference: "Let's read it in the KJV. 1 John 1:9."
  await tab.hear("Let's read it in the KJV. 1 John 1:9.", true);
  assert.equal(tab.chosen, "KJV", "switched back to KJV");
  assert.equal(tab.screen.at(-1), "1 John 1:9 KJV", "1 John 1:9 projected in KJV");
});

// =========================================================================
// 4. OPERATIONAL MODE SEPARATION: SHOW IT vs FIND IT
// =========================================================================
test("Mode Permissions: FIND IT strictly updates box/suggestions and NEVER projects to screen", async () => {
  const tabFind = createTestTab({
    onHeard: "find", // FIND IT mode
    quotes: () => ({
      pk: "kjv|john|3|16",
      bookId: "john",
      chapter: 3,
      verse: 16,
      version: "kjv",
    }),
  });

  // Direct quotation
  await tabFind.hear("For God so loved the world that he gave his only begotten Son.", true);
  assert.deepEqual(tabFind.screen, [], "FIND IT: screen NEVER changes automatically");
  assert.equal(tabFind.box, "John 3:16", "FIND IT: box updated with suggestion");

  // Explicit navigation command in FIND IT mode
  await tabFind.hear("Turn to Romans 8:28.", true);
  assert.deepEqual(tabFind.screen, [], "FIND IT: screen STILL never changes");
  assert.equal(tabFind.box, "Romans 8:28", "FIND IT: box updated with navigation target");

  // Contrast with SHOW IT mode
  const tabShow = createTestTab({
    onHeard: "show", // SHOW IT mode
  });
  await tabShow.hear("Turn to Romans 8:28.", true);
  assert.deepEqual(tabShow.screen, ["Romans 8:28 KJV"], "SHOW IT: screen projects automatically");
});

// =========================================================================
// 5. SPEECH INTENT CLASSIFICATION & DISCRIMINATION
// =========================================================================
test("Speech Intent: Commentary and Reference Mentions do NOT project; Navigation and Reading DO", async () => {
  let modelIntent = "COMMENTARY";
  const tab = createTestTab({
    onHeard: "show",
    model: () => ({
      reference: "Romans 8:28",
      sure: true,
      intent: modelIntent,
    }),
  });

  // A. Commentary: Pastor talks ABOUT Romans 8:28 conceptually
  modelIntent = "COMMENTARY";
  await tab.hear("The Apostle Paul reminds us that in everything God works for good when we walk in faith.", true);
  assert.deepEqual(tab.screen, [], "COMMENTARY intent must NOT project to screen");

  // B. Passing reference mention: "As Paul says in Romans 8:28..."
  modelIntent = "REFERENCE_MENTION";
  await tab.hear("As Paul says in Romans 8:28, all things work together.", true);
  assert.deepEqual(tab.screen, [], "REFERENCE_MENTION intent must NOT project to screen");

  // C. Explicit navigation request: "Turn with me to Romans 8:28."
  modelIntent = "NAVIGATION_REQUEST";
  await tab.hear("Turn with me to Romans 8:28.", true);
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"], "NAVIGATION_REQUEST projects to screen");
});

// =========================================================================
// 6. STALE LLM DECISION REJECTION
// =========================================================================
test("Stale Rejection: Late LLM decision does not overwrite newer user navigation", async () => {
  let resolveModel = () => undefined;
  const tab = createTestTab({
    onHeard: "show",
    model: () =>
      new Promise((resolve) => {
        resolveModel = () => resolve({ reference: "Genesis 1:1", sure: true, intent: "SCRIPTURE_READING" });
      }),
  });

  // Step 1: Slow query initiated for Genesis 1:1
  await tab.hear("In the beginning, God created the heavens and the earth.");

  // Step 2: Pastor moves ahead to Romans 8:28
  await tab.hear("Turn to Romans 8:28.", true);
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"], "Screen shows newer Romans 8:28");

  // Late model response for Step 1 arrives now
  resolveModel();
  await settle();
  await settle();

  // Screen must NOT be overwritten by the delayed Step 1 response!
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"], "Delayed LLM response discarded; screen remains on Romans 8:28");
});

// =========================================================================
// 7. SAFE FAILURE: PRESERVE SCREEN & SELECTED TRANSLATION ON MODEL FAILURE
// =========================================================================
test("Safe Failure: Preserves current screen and selected translation if models fail", async () => {
  const tab = createTestTab({
    onHeard: "show",
    defaultVersion: "KJV",
    model: () => null, // Both models failed / unavailable
  });

  // Start with a known screen state
  await tab.hear("Turn to Romans 8:28.", true);
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"]);
  assert.equal(tab.chosen, "KJV");

  // Models fail or are completely unavailable
  await tab.hear("Some totally ambiguous or unparseable phrase during Gateway outage", true);

  // Screen and selected translation MUST remain unchanged!
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"], "Screen is safely preserved on model failure");
  assert.equal(tab.chosen, "KJV", "Selected translation is safely preserved");
});

