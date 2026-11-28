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
    createContext({ exports: module.exports, module, require, Promise, Set, Map, setTimeout, Date }),
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
const reading = load("../src/features/scripture/lib/reading.ts", { "./listening": listening });
const { createHeardScripture } = load("../src/features/scripture/lib/heard-scripture.ts", {
  "./parser": parser,
  "./listening": listening,
  "./reading": reading,
  "./transcript-buffer": transcriptBuffer,
  "./command-parser": commandParser,
  "./step-reference.mjs": stepReference,
});

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
];

/** Let the model's and the quote finder's answers arrive. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The Bible tab, as far as the agent can see it: a box, a screen, a Bible
 * chosen, and a model and a quote finder that answer as told.
 */
const bibleTab = ({
  onHeard = "show",
  model = () => null,
  quotes = () => null,
  bibles = versions,
  catalog = [],
  install = async () => false,
  chapters = {},
  defaultVersion = "KJV",
} = {}) => {
  const tab = {
    box: "",
    chosen: defaultVersion,
    screen: [],
    asked: [],
    followed: [],
    settings: {},
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
    follow: (verse, word) => {
      if (tab.followed.at(-1)?.verse !== verse) tab.followed.push({ verse, word });
    },
    ...tab.settings,
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
            mayProject: answer.sure,
            story: Boolean(answer.story),
          }
        : null;
    },
    findQuotedVerse: async (input) => quotes(input),
    versionCodeOf: (id) => bibles.find((version) => version.id === id)?.code ?? "KJV",
    readChapter: async (book, chapter, versionCode) =>
      chapters[`${book.id} ${chapter} ${versionCode}`] ?? chapters[`${book.id} ${chapter}`] ?? [],
  });
  const agent = createHeardScripture(settings());
  tab.stopListening = () => agent.forget();
  tab.refresh = () => agent.update(settings());
  tab.hear = async (words, isFinal = false) => {
    agent.update(settings());
    agent.hear(words, isFinal);
    await settle();
    await settle();
  };
  return tab;
};

// What AssemblyAI's Universal-3.5 Pro sent for a fast reading of John 3,
// partial by partial, at a short pause each (`max_turn_silence` 500 ms,
// `interruption_delay` 0).
const JOHN_3 = [
  "Turn with me",
  "Turn with me to the book of John chapter 3 and the 3rd verse.",
  "Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him,",
  "Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him, verily, verily, I say unto thee,",
  "Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him, verily, verily, I say unto thee, except a man be born again, he cannot see the kingdom of God.",
  "Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him, verily, verily, I say unto thee, except a man be born again, he cannot see the kingdom of God. And then look at verse 16.",
  "Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him, verily, verily, I say unto thee, except a man be born again, he cannot see the kingdom of God. And then look at verse 16. For God so loved the world that he gave his one and only Son,",
];

// The model as measured, on the instruction it is given now.
const measuredModel = (heard) => {
  if (/verse 16/.test(heard)) return { reference: "John 3:16", sure: true };
  if (/3rd verse/.test(heard)) return { reference: "John 3:3", sure: true };
  if (/John, chapter 10/.test(heard)) return { reference: "John 10", sure: true };
  return null;
};

test("Show it: each passage goes up as it is said, not when the sentence ends", async () => {
  const tab = bibleTab({ model: measuredModel });
  await tab.hear(JOHN_3[0]);
  assert.deepEqual(tab.screen, []);
  assert.deepEqual(tab.asked, [], "nothing in it names a passage");

  await tab.hear(JOHN_3[1]);
  assert.deepEqual(tab.screen, ["John 3:3 KJV"], "the model read 'the 3rd verse'");
  assert.equal(tab.box, "John 3:3");

  for (const words of JOHN_3.slice(2, 5)) await tab.hear(words);
  assert.deepEqual(tab.screen, ["John 3:3 KJV"], "the verse being read is the passage on screen");

  const asked = tab.asked.length;
  await tab.hear(JOHN_3[5]);
  assert.deepEqual(tab.screen, ["John 3:3 KJV", "John 3:16 KJV"], "read at once, no model");
  assert.equal(tab.asked.length, asked);
});

test("Show it: a quote matching another Bible translation does not switch the active Bible", async () => {
  const tab = bibleTab({
    model: measuredModel,
    // John 3:16 as the NIV has it is what was being read.
    quotes: ({ query }) =>
      /one and only Son,?$/.test(query)
        ? { pk: "niv|john|3|16", version: "niv", bookId: "john", chapter: 3, verse: 16 }
        : null,
  });
  for (const words of JOHN_3) await tab.hear(words);
  assert.deepEqual(tab.screen, [
    "John 3:3 KJV",
    "John 3:16 KJV",
  ]);
  assert.equal(tab.chosen, "KJV", "translation invariant: matching score cannot switch active Bible");
});

test("a quote is looked for in the Bible in use only, and in another once it is asked for", async () => {
  const looked = [];
  const tab = bibleTab({
    quotes: ({ versionCode, versions }) => {
      looked.push(`${versions} ${versionCode}`);
      return null;
    },
  });
  await tab.hear("For God so loved the world that he gave");
  assert.ok(looked.length > 0, "a quote was looked for");
  assert.deepEqual([...new Set(looked)], ["chosen KJV"], "never every Bible installed");
  looked.length = 0;
  await tab.hear("Switch to NIV.");
  await tab.hear("For God so loved the world that he gave his one and only");
  assert.equal(tab.chosen, "NIV");
  assert.deepEqual([...new Set(looked)].at(-1), "chosen NIV", "the next quote is looked for there");
  assert.ok(looked.every((each) => each.startsWith("chosen ")));
});

test("Show it: \"in the ESV\" shows the passage on screen in the ESV", async () => {
  // Only "give me ESV" did; "in ESV", as a preacher says it, did nothing.
  const tab = bibleTab({ bibles: installed });
  await tab.hear("John 3:16.", true);
  assert.deepEqual(tab.screen, ["John 3:16 KJV"]);
  await tab.hear("In the ESV.", true);
  assert.equal(tab.chosen, "ESV");
  assert.equal(tab.screen.at(-1), "John 3:16 ESV (not added again)");
  await tab.hear("Romans 8:28 in NIV.", true);
  assert.equal(tab.chosen, "NIV");
  assert.equal(tab.screen.at(-1), "Romans 8:28 NIV");
});

test("Show it: an explicit version command is recognized and switches translation", async () => {
  const tab = bibleTab();
  await tab.hear("Somebody shout amen. Romans 8:28.");
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"]);
  await tab.hear(
    "Switch to NIV.",
  );
  assert.equal(tab.chosen, "NIV");

  await tab.hear(
    "Let's read it in the KJV. 1 John 1:9.",
  );
  assert.equal(tab.chosen, "KJV");
  assert.equal(tab.screen.at(-1), "1 John 1:9 KJV");
});

test("Show it: a chapter waits for the verse that may follow it", async () => {
  const tab = bibleTab({ model: measuredModel });
  // One of Universal-3.5 Pro's guesses on the way to the right words.
  await tab.hear("Turn with me to the book of John, chapter 10.");
  assert.deepEqual(tab.screen, [], "John 10 may yet be John 10 verse something");
  assert.equal(tab.box, "John 10", "but it is in the box");
  await tab.hear("Turn with me to the book of John chapter 3 and the 3rd verse.");
  assert.deepEqual(tab.screen, ["John 3:3 KJV"], "and the guess never went up");

});

test("Show it: when the turn ends, what was waiting goes up", async () => {
  const tab = bibleTab();
  await tab.hear("Turn with me to Romans 8:28 in the");
  assert.deepEqual(tab.screen, [], "the NIV, perhaps?");
  await tab.hear("Turn with me to Romans 8:28 in the.", true);
  assert.deepEqual(tab.screen, ["Romans 8:28 KJV"]);
});

test("Find it: the same reading, into the box only", async () => {
  const tab = bibleTab({ onHeard: "find", model: measuredModel });
  for (const words of JOHN_3) await tab.hear(words);
  assert.deepEqual(tab.screen, []);
  assert.equal(tab.box, "John 3:16");
});

test("an answer overtaken by newer words is not acted on", async () => {
  let answerSlowly = () => undefined;
  const tab = bibleTab({
    model: (heard) =>
      /verse 16/.test(heard)
        ? null
        : new Promise((resolve) => {
            answerSlowly = () => resolve({ reference: "John 3:3", sure: true });
          }),
  });
  await tab.hear(JOHN_3[1]);
  assert.deepEqual(tab.screen, [], "the model is still thinking");
  await tab.hear(JOHN_3[5]);
  assert.deepEqual(tab.screen, ["John 3:16 KJV"], "verse 16 is read at once meanwhile");
  answerSlowly();
  await settle();
  await settle();
  assert.deepEqual(tab.screen, ["John 3:16 KJV"], "and the late answer does not put John 3:3 back");
});

test("nothing is read while the Bible tab is not the one open", async () => {
  const tab = bibleTab({ model: measuredModel });
  tab.open = false;
  await tab.hear(JOHN_3[1]);
  assert.deepEqual(tab.screen, []);
  assert.deepEqual(tab.asked, []);
});

test("an answer to words heard before listening stopped is dropped", async () => {
  let answerSlowly = () => undefined;
  const tab = bibleTab({
    model: () =>
      new Promise((resolve) => {
        answerSlowly = () => resolve({ reference: "John 3:3", sure: true });
      }),
  });
  await tab.hear(JOHN_3[1]);
  tab.stopListening();
  answerSlowly();
  await settle();
  await settle();
  assert.deepEqual(tab.screen, []);
});

test("an answer that only repeats the passage already open is ignored", async () => {
  // Gemini 2.5 Flash-Lite, measured: words naming no passage, with one open,
  // are answered with the open one at confidence 1.
  const echo = (heard, open) => (open ? { reference: open, sure: true } : null);
  const tab = bibleTab({ model: echo });
  tab.box = "John 3:16";
  await tab.hear("John said one thing to the crowd that day");
  assert.deepEqual(tab.screen, [], "it was never shown, and is not shown now");

  // Said again in so many words, it is the passage being named.
  const named = bibleTab({ model: echo });
  named.box = "John 3:16";
  await named.hear("Turn with me to John 3 16 for God so loved the world");
  assert.deepEqual(named.screen, ["John 3:16 KJV"]);
});

// A story told in the preacher's own words, as gpt-oss-120b reads it.
const DAVID = [
  "remember when David",
  "remember when David took five smooth stones from the brook and ran toward",
  "remember when David took five smooth stones from the brook and ran toward the giant with his sling, and the stone sank into his forehead",
];
// The King James, as installed: what the model names has to be in these
// words before it is shown (`reading.ts`).
const FIRST_SAMUEL_17 = [
  [39, "And David girded his sword upon his armour, and he assayed to go; for he had not proved it. And David said unto Saul, I cannot go with these; for I have not proved them. And David put them off him."],
  [40, "And he took his staff in his hand, and chose him five smooth stones out of the brook, and put them in a shepherd's bag which he had, even in a scrip; and his sling was in his hand: and he drew near to the Philistine."],
  [49, "And David put his hand in his bag, and took thence a stone, and slang it, and smote the Philistine in his forehead, that the stone sunk into his forehead; and he fell upon his face to the earth."],
].map(([verse, text]) => ({ verse, text }));
const LUKE_15 = [
  { verse: 20, text: "And he arose, and came to his father. But when he was yet a great way off, his father saw him, and had compassion, and ran, and fell on his neck, and kissed him." },
];
const storyModel = (heard) => {
  if (/forehead/.test(heard)) return { reference: "1 Samuel 17:49", sure: true, story: true };
  if (/smooth stones/.test(heard)) return { reference: "1 Samuel 17:40", sure: true, story: true };
  return null;
};

test("Show it: a story told is recognised and shown, once", async () => {
  const tab = bibleTab({ model: storyModel, chapters: { "1samuel 17": FIRST_SAMUEL_17 } });
  await tab.hear(DAVID[0]);
  assert.deepEqual(tab.asked, [], "three words are not yet worth asking about");
  await tab.hear(DAVID[1]);
  assert.equal(tab.asked.length, 1, "a dozen words are");
  assert.deepEqual(tab.screen, ["1 Samuel 17:40 KJV"]);
  await tab.hear(DAVID[2]);
  assert.equal(tab.asked.length, 2);
  assert.deepEqual(
    tab.screen,
    ["1 Samuel 17:40 KJV"],
    "the story moving on to verse 49 is the same passage, not a new one to show",
  );
});

test("Find it: a story told goes into the box", async () => {
  const tab = bibleTab({ onHeard: "find", model: storyModel });
  for (const words of DAVID.slice(0, 2)) await tab.hear(words);
  assert.equal(tab.box, "1 Samuel 17:40");
  assert.deepEqual(tab.screen, []);
});

test("the end of a turn is asked about, if a few words were not yet", async () => {
  const john3 = [
    { verse: 16, text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
  ];
  const tab = bibleTab({
    model: () => ({ reference: "John 3:16", sure: true, story: false }),
    chapters: { "john 3": john3 },
  });
  await tab.hear("God so loved the world");
  assert.deepEqual(tab.asked, []);
  await tab.hear("God so loved the world.", true);
  assert.equal(tab.asked.length, 1);
  assert.deepEqual(tab.screen, ["John 3:16 KJV"]);
});

test("Show it: what the model is sure of is shown only when the words bear it out", async () => {
  // "One day a man" went up as a verse. The model may be as sure as it
  // likes: nothing said is in the verse it names.
  const sure = bibleTab({
    model: () => ({ reference: "Luke 15:20", sure: true, story: true }),
    chapters: { "luke 15": LUKE_15 },
  });
  await sure.hear("One day a man.", true);
  await sure.hear("One day a man came to my office and he said, pastor, I need your help.", true);
  assert.equal(sure.asked.length, 2, "the model was asked, and answered");
  assert.deepEqual(sure.screen, [], "and the screen did not take its word for it");
  assert.equal(sure.box, "Luke 15:20", "it is in the box, for the operator to weigh");

  // A verse that is not in the Bible is not shown, whoever names it.
  parser.knowVerseCounts((book, chapter) => (book === "John" && chapter === 3 ? 36 : null));
  const none = bibleTab({ model: () => ({ reference: "John 3:37", sure: true }) });
  await none.hear("John 3:37.", true);
  assert.deepEqual(none.screen, []);
  assert.equal(none.box, "");
  parser.knowVerseCounts(() => null);
});

test("a second story told straight after the first is recognised", async () => {
  // Given David still in what it is sent as new, the model answers David.
  const model = (heard) => {
    if (/smooth stones/.test(heard)) return { reference: "1 Samuel 17:40", sure: true, story: true };
    if (/long way off/.test(heard)) return { reference: "Luke 15:20", sure: true, story: true };
    return null;
  };
  const tab = bibleTab({
    model,
    chapters: { "1samuel 17": FIRST_SAMUEL_17, "luke 15": LUKE_15 },
  });
  const david =
    "Church, I want you to remember when David took 5 smooth stones out of the brook and put them in his shepherd's bag,";
  await tab.hear(david);
  await tab.hear(
    `${david} and he ran toward the giant. And think about the father who saw him a long way off and had compassion and ran and kissed him`,
  );
  assert.deepEqual(tab.screen, ["1 Samuel 17:40 KJV", "Luke 15:20 KJV"]);
  assert.match(tab.earlier, /smooth stones/, "David is sent as what came before");
});

// The Bibles as the catalog installs them: each named by its code alone.
const installed = ["AMP", "ESV", "NKJV", "NIV", "KJV"].map((code) => ({
  id: code.toLowerCase(),
  code,
  name: code,
}));

test("Show it: 'give me KJV' shows the passage on screen in the KJV", async () => {
  // As it was said in the app, and logged: the quote is the ESV's, word for
  // word; then a verse; then a Bible.
  const tab = bibleTab({
    defaultVersion: "ESV",
    bibles: installed,
    quotes: ({ query }) =>
      /have mercy on those who doubt\.?$/i.test(query)
        ? { pk: "esv|jude|1|22", version: "esv", bookId: "jude", chapter: 1, verse: 22 }
        : null,
  });
  await tab.hear("And have mercy on those who doubt.", true);
  assert.deepEqual(tab.screen, ["Jude 1:22 ESV"]);
  await tab.hear("Give me verse 23.");
  await tab.hear("Give me verse 23.", true);
  assert.deepEqual(tab.screen, ["Jude 1:22 ESV", "Jude 1:23 ESV"]);
  assert.ok(
    !tab.asked.some((heard) => /verse 23/.test(heard)),
    "a verse read already is not asked about again",
  );
  await tab.hear("Give me KJV.", true);
  assert.deepEqual(tab.screen, ["Jude 1:22 ESV", "Jude 1:23 ESV", "Jude 1:23 KJV (not added again)"]);
  assert.equal(tab.chosen, "KJV");
  await tab.hear("Now read it in the New International Version.", true);
  assert.equal(tab.screen.at(-1), "Jude 1:23 NIV (not added again)", "named in full, too");
});

test("a late answer to words since heard again is not acted on", async () => {
  const answers = [];
  const tab = bibleTab({
    model: () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
    chapters: { "jude 1": [{ verse: 22, text: "And have mercy on those who doubt;" }] },
  });
  await tab.hear("And have mercy on those who die", true);
  await tab.hear("And have mercy on those who doubt.", true);
  assert.equal(answers.length, 2);
  answers[1]({ reference: "Jude 1:22", sure: true });
  await settle();
  answers[0]({ reference: "Psalms 116:8", sure: false, confidence: 0.7 });
  await settle();
  await settle();
  assert.deepEqual(tab.screen, ["Jude 1:22 KJV"]);
  assert.equal(tab.box, "Jude 1:22", "and the old guess does not take the box");
});

test("a guess is not put anywhere", async () => {
  const tab = bibleTab({ model: () => ({ reference: "Psalms 107:1", sure: false, confidence: 0.3 }) });
  await tab.hear("God is good all the time and all the time God is good", true);
  assert.equal(tab.asked.length, 1);
  assert.equal(tab.box, "");
});

test("a Bible asked for that is not installed is downloaded, and the passage shown in it", async () => {
  // As in the dev build: only the ESV installed, the KJV in the catalog.
  const bibles = [{ id: "esv", code: "ESV", name: "ESV" }];
  const downloads = [];
  const tab = bibleTab({
    bibles,
    catalog: [{ id: "kjv", code: "KJV", name: "King James Version" }],
    install: async (code, tab) => {
      downloads.push(code);
      bibles.push({ id: code.toLowerCase(), code, name: code });
      tab.refresh();
      return true;
    },
  });
  tab.chosen = "ESV";
  tab.box = "Jude 1:22";
  await tab.hear("Give me verse 23.", true);
  assert.deepEqual(tab.screen, ["Jude 1:23 ESV"]);
  await tab.hear("Give me in KJV.");
  await tab.hear("Give me in KJV.", true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(downloads, ["KJV"], "downloaded once, however often it is heard");
  assert.equal(tab.chosen, "KJV", "the Bible menu is on it");
  assert.deepEqual(tab.screen, ["Jude 1:23 ESV", "Jude 1:23 KJV (not added again)"]);
});

test("a download that failed is not tried again until it is asked for again", async () => {
  const downloads = [];
  const tab = bibleTab({
    bibles: [{ id: "esv", code: "ESV", name: "ESV" }],
    catalog: [{ id: "kjv", code: "KJV", name: "King James Version" }],
    install: async (code) => {
      downloads.push(code);
      return false;
    },
  });
  await tab.hear("Give me in KJV.", true);
  await tab.hear("Give me in KJV. Please.", true);
  assert.deepEqual(downloads, ["KJV"]);
  await tab.hear("Let us pray.", true);
  await tab.hear("And then something else entirely.", true);
  await tab.hear("Give me in KJV.", true);
  assert.deepEqual(downloads, ["KJV", "KJV"], "asked for again, tried again");
});

test("a late answer does not put the verse on screen back into the Bible it was asked in", async () => {
  // With KJV in use: Genesis 1:1 goes up in the KJV. Under the translation lock invariant,
  // speech matching ESV does not displace KJV.
  // When an LLM answer arrives 5 seconds late, it is discarded and does not overwrite screen.
  let answerLate = () => undefined;
  const tab = bibleTab({
    model: () =>
      new Promise((resolve) => {
        answerLate = () => resolve({ reference: "Genesis 1:1", sure: true });
      }),
    quotes: ({ query }) =>
      /heavens/.test(query)
        ? { pk: "esv|genesis|1|1", version: "esv", bookId: "genesis", chapter: 1, verse: 1 }
        : /God created/.test(query)
          ? { pk: "kjv|genesis|1|1", version: "kjv", bookId: "genesis", chapter: 1, verse: 1 }
          : null,
    bibles: [
      { id: "kjv", code: "KJV", name: "KJV" },
      { id: "esv", code: "ESV", name: "ESV" },
    ],
  });
  await tab.hear("In the beginning, God created the heavens and the earth.", true);
  assert.deepEqual(tab.screen, ["Genesis 1:1 KJV"]);
  answerLate();
  await settle();
  await settle();
  assert.deepEqual(tab.screen, ["Genesis 1:1 KJV"], "not overwritten by late answer");
});

// The King James, as installed: the chapters read along with below.
const GENESIS_1 = [
  "In the beginning God created the heaven and the earth.",
  "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
  "And God said, Let there be light: and there was light.",
  "And God saw the light, that it was good: and God divided the light from the darkness.",
  "And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.",
].map((text, index) => ({ verse: index + 1, text }));
const REVELATION_1 = [
  "The Revelation of Jesus Christ, which God gave unto him, to shew unto his servants things which must shortly come to pass; and he sent and signified it by his angel unto his servant John:",
  "Who bare record of the word of God, and of the testimony of Jesus Christ, and of all things that he saw.",
  "Blessed is he that readeth, and they that hear the words of this prophecy, and keep those things which are written therein: for the time is at hand.",
].map((text, index) => ({ verse: index + 1, text }));

test("Show it: reading on into the next verse moves to it within two words", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  const said = (...parts) => tab.hear(parts.join(" "));
  const verse1 = "In the beginning God created the heaven and the earth.";
  await said("Genesis chapter 1 verse 1.");
  assert.deepEqual(tab.screen, ["Genesis 1:1 KJV"]);
  await said("Genesis chapter 1 verse 1.", verse1);
  assert.equal(tab.screen.length, 1, "a verse named and read stays up: a sermon may go on from it");
  await said("Genesis chapter 1 verse 1.", verse1, "And the");
  assert.equal(tab.screen.at(-1), "Genesis 1:2 KJV (not added again)", "two words into verse 2");
  await said("Genesis chapter 1 verse 1.", verse1, "And the earth was without form, and void;");
  assert.equal(tab.screen.length, 2, "and stays there while it is read");
  await said(
    "Genesis chapter 1 verse 1.",
    verse1,
    "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the",
  );
  assert.equal(tab.screen.length, 2);
  await said(
    "Genesis chapter 1 verse 1.",
    verse1,
    "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
  );
  assert.equal(
    tab.screen.at(-1),
    "Genesis 1:3 KJV (not added again)",
    "read on to, a verse is moved on from at its last word: the passage is being read through",
  );
  assert.equal(tab.box, "Genesis 1:3");
});

test("Show it: a verse read on to is not moved on from when only its last words are said", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Genesis chapter 1 verse 2.", true);
  await tab.hear("And the Spirit of God moved upon the face of the waters. And God said", true);
  assert.equal(tab.screen.at(-1), "Genesis 1:3 KJV (not added again)");
  await tab.hear("Notice, and there was light.", true);
  assert.equal(tab.screen.length, 2, "quoting its end is not reading it");
});

test("Show it: moving on at a verse's end can be turned off", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  tab.settings = { moveAtVerseEnd: false };
  await tab.hear("Genesis chapter 1 verse 1.", true);
  await tab.hear("In the beginning God created the heaven and the earth. And the earth", true);
  assert.equal(tab.screen.at(-1), "Genesis 1:2 KJV (not added again)");
  await tab.hear("was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.", true);
  assert.equal(tab.screen.length, 2, "waits for the next verse to begin");
});

test("Show it: a passage of several verses is followed slide by slide as it is read", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Let's read the first three verses. Genesis 1:1-3.", true);
  assert.deepEqual(tab.screen, ["Genesis 1:1-3 KJV"]);
  await tab.hear("In the beginning God created the heaven and the", true);
  assert.equal(tab.followed.at(-1)?.verse ?? 1, 1);
  await tab.hear("earth.", true);
  assert.equal(tab.followed.at(-1)?.verse, 2, "verse 1 read to its end: verse 2's slide");
  await tab.hear("And the earth was without form, and void; and darkness was upon the face of the deep.", true);
  assert.equal(tab.followed.at(-1)?.verse, 2);
  await tab.hear("And the Spirit of God moved upon the face of the waters.", true);
  assert.equal(tab.followed.at(-1)?.verse, 3);
  await tab.hear("And God said, Let there be light: and there was light.", true);
  assert.equal(tab.followed.at(-1)?.verse, 3, "the last verse of the passage is not read past at its end");
  assert.deepEqual(tab.screen, ["Genesis 1:1-3 KJV"], "the passage stays on screen throughout");
  await tab.hear("And God saw the light, that it was good", true);
  assert.equal(tab.screen.at(-1), "Genesis 1:4 KJV (not added again)", "read on past it, the next verse goes up");
});

test("Show it: the model naming a verse of the passage on screen does not take the passage's place", async () => {
  // The model's answer comes seconds after the words: "Genesis 1:1" for
  // verse 1 arrived as verse 2 was begun, and put verse 1 alone on screen.
  const tab = bibleTab({
    chapters: { "genesis 1": GENESIS_1 },
    model: (heard) => (/beginning/i.test(heard) ? { reference: "Genesis 1:1", sure: true } : null),
  });
  await tab.hear("Genesis 1:1-3.", true);
  await tab.hear("In the beginning God created the heaven and the earth.", true);
  await tab.hear("And the earth was without form, and void;", true);
  assert.deepEqual(tab.screen, ["Genesis 1:1-3 KJV"], "the passage stays up");
  assert.equal(tab.followed.at(-1)?.verse, 2, "at the verse being read");
});

test("Show it: a passage read on even when the last word of a verse is heard wrong", async () => {
  // "earth" heard as "8": the reading has not gone anywhere else.
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Genesis 1:1-3.", true);
  await tab.hear("In the beginning God created the heaven and the 8.", true);
  assert.equal(tab.followed.at(-1)?.verse, 2);
  assert.deepEqual(tab.screen, ["Genesis 1:1-3 KJV"]);
});

test("Show it: a verse said before its book goes up", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Let us look at the third verse of Genesis chapter one.", true);
  assert.deepEqual(tab.screen, ["Genesis 1:3 KJV"]);
  const range = bibleTab();
  await range.hear("Read with me verses one to three of John chapter three.", true);
  assert.deepEqual(range.screen, ["John 3:1-3 KJV"]);
});

test("reading on after a pause moves on once the words say which verse it is", async () => {
  const tab = bibleTab({ chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Genesis chapter 1 verse 2.", true);
  await tab.hear("Wow, think about that for a moment.", true);
  assert.deepEqual(tab.screen, ["Genesis 1:2 KJV"], "what is not read from it moves nothing");
  await tab.hear("And God said");
  assert.deepEqual(tab.screen, ["Genesis 1:2 KJV"], "three words that begin a hundred verses are not the next one");
  await tab.hear("And God said, Let there be light");
  assert.equal(tab.screen.at(-1), "Genesis 1:3 KJV (not added again)");
});

test("a verse read from another Bible installed is followed in that Bible, and shown in the one chosen", async () => {
  // The King James ends John 3:15 "should not perish, but have eternal life";
  // the NIV has those words only in 3:16. Followed in the NIV on screen, the
  // reading went a verse ahead of the reader.
  const tab = bibleTab({
    defaultVersion: "NIV",
    chapters: {
      "john 3 NIV": [
        { verse: 15, text: "that everyone who believes in him may have eternal life." },
        { verse: 16, text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life." },
        { verse: 17, text: "For God did not send his Son into the world to condemn the world, but to save the world through him." },
      ],
      "john 3 KJV": [
        { verse: 15, text: "That whosoever believeth in him should not perish, but have eternal life." },
        { verse: 16, text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
        { verse: 17, text: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved." },
      ],
    },
  });
  await tab.hear("John 3:15.", true);
  assert.deepEqual(tab.screen, ["John 3:15 NIV"]);
  await tab.hear("That whosoever believeth in him should not perish,", true);
  await tab.hear("but have eternal life.", true);
  assert.deepEqual(tab.screen, ["John 3:15 NIV"], "read from the King James, it is still verse 15");
  await tab.hear("For God so loved the world,", true);
  assert.equal(tab.screen.at(-1), "John 3:16 NIV (not added again)", "and verse 16 when the reader reaches it");
  assert.equal(tab.screen.length, 2);
  assert.equal(tab.chosen, "NIV", "the Bible on screen is not changed by what is read from");
});

test("Find it: the box reads along too", async () => {
  const tab = bibleTab({ onHeard: "find", chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("Genesis chapter 1 verse 1. In the beginning God created the heaven and the earth. And the");
  assert.equal(tab.box, "Genesis 1:2");
  assert.deepEqual(tab.screen, []);
});

test("Show it: a chapter said alone waits in the box for the verse", async () => {
  // Said in the app: "Revelation chapter 1", and verse 1 went up unasked.
  const tab = bibleTab({
    model: () => ({ reference: "Revelation 1", sure: true }),
    chapters: { "revelation 1": REVELATION_1 },
  });
  await tab.hear("Revelations chapter 1.", true);
  assert.equal(tab.box, "Revelation 1");
  assert.deepEqual(tab.screen, [], "nobody asked for verse 1");
  await tab.hear("The Revelation of Jesus");
  assert.deepEqual(tab.screen, ["Revelation 1:1 KJV (not added again)"], "until it is read");

  const named = bibleTab({ chapters: { "revelation 1": REVELATION_1 } });
  await named.hear("Revelations chapter 1.", true);
  await named.hear("Verse 3.", true);
  assert.deepEqual(named.screen, ["Revelation 1:3 KJV"], "or said");
});

/**
 * The quote finder as it answers the first words of Genesis 1:1, said alone:
 * they open John 1:1 too, and Genesis 1:1 is the better known.
 */
const IN_THE_BEGINNING = {
  pk: "kjv|genesis|1|1",
  version: "kjv",
  bookId: "genesis",
  chapter: 1,
  verse: 1,
  text: "In the beginning God created the heaven and the earth.",
  suggested: {
    fromEnd: 3,
    rivals: [{ pk: "kjv|john|1|1", bookId: "john", chapter: 1, verse: 1, text: "In the beginning was the Word, and the Word was with God, and the Word was God." }],
  },
};
const beginsGenesis = ({ query }) => (/in the beginning\.?$/i.test(query.trim()) ? IN_THE_BEGINNING : null);

test("Show it: the first words of a verse are suggested in the box, not shown", async () => {
  const tab = bibleTab({ quotes: beginsGenesis });
  await tab.hear("In the beginning.", true);
  assert.equal(tab.box, "Genesis 1:1", "the operator can show it");
  assert.deepEqual(tab.screen, [], "the screen waits");

  const find = bibleTab({ onHeard: "find", quotes: beginsGenesis });
  await find.hear("In the beginning.", true);
  assert.equal(find.box, "Genesis 1:1", "Find it suggests the same");
});

test("Show it: a suggested verse goes up when the rest of it is said after a pause, not word for word", async () => {
  // "Heavens", where the King James has "heaven": not a quote word for word,
  // which is all the quote finder takes. Two turns: a pause between.
  const tab = bibleTab({ quotes: beginsGenesis, chapters: { "genesis 1": GENESIS_1 } });
  await tab.hear("There was a day when I went to the sitting room and I saw something.", true);
  await tab.hear("In the beginning.", true);
  assert.deepEqual(tab.screen, []);
  await tab.hear("God created the heavens and the earth.", true);
  assert.deepEqual(tab.screen, ["Genesis 1:1 KJV"], "the story before it was not part of it");
});

test("a suggestion whose verse is not said stays in the box", async () => {
  const tab = bibleTab({ quotes: beginsGenesis });
  await tab.hear("In the beginning.", true);
  await tab.hear("Of this year, I told you that this is our year, and the earth will hear about it.", true);
  assert.deepEqual(tab.screen, []);
  assert.equal(tab.box, "Genesis 1:1");

  // Nor is one whose words are another's it began as well.
  const john = bibleTab({ quotes: beginsGenesis });
  await john.hear("In the beginning.", true);
  await john.hear("Was the Word, and the Word was with God.", true);
  assert.deepEqual(john.screen, []);
});

test("Show it: what the model is less than sure of is suggested", async () => {
  const tab = bibleTab({ model: () => ({ reference: "Genesis 1:1", sure: false, confidence: 0.7 }) });
  await tab.hear("In the beginning.", true);
  assert.equal(tab.asked.length, 1);
  assert.equal(tab.box, "Genesis 1:1", "in the box");
  assert.deepEqual(tab.screen, [], "and not on screen");
});
