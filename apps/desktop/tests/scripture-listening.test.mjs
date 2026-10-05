import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// The parser and the listening module, as the app runs them, with the one
// importing the other.
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
    createContext({ exports: module.exports, module, require }),
  );
  return module.exports;
};

const parser = load("../src/features/scripture/lib/parser.ts");
const {
  asLookup,
  cuesOf,
  bookWordsOf,
  findNamedVersion,
  mayStillGrow,
  passageHolds,
  readNewestReference,
  versionKeyterms,
  readingAt,
  readingWords,
  movedOn,
} = load("../src/features/scripture/lib/listening.ts", { "./parser": parser });

const books = [
  ["genesis", "Genesis", 50],
  ["psalms", "Psalms", 150],
  ["habakkuk", "Habakkuk", 3],
  ["mark", "Mark", 16],
  ["john", "John", 21],
  ["romans", "Romans", 16],
  ["1john", "1 John", 5],
].map(([id, name, chapters]) => ({ pk: `kjv|${id}`, version: "kjv", id, name, chapters }));
const nothingOpen = parser.parseReference("", books);
const open = (reference) => parser.parseReference(reference, books);

const read = (text, opened = nothingOpen) => {
  const reading = readNewestReference(text, books, opened);
  return reading ? `${asLookup(reading.reference)}${reading.plain ? "" : " (ask)"}` : null;
};

// Every transcript below is one AssemblyAI's Universal-3.5 Pro sent, live,
// for a fast reading of a sermon.
test("the newest passage named is read, as the words arrive", () => {
  assert.equal(read("Somebody shout amen. Romans 8:28."), "Romans 8:28");
  assert.equal(
    read("Somebody shout amen! Romans 8:28 in the New International Version says, and we know that in all"),
    "Romans 8:28",
  );
  assert.equal(
    read("and we know that in all things God works for the good of those who love him. Now go to Habakkuk 2:3."),
    "Habakkuk 2:3",
  );
  assert.equal(read("Let's read it in the KJV. 1 John 1:9."), "1 John 1:9", "not John 1:9");
  assert.equal(read("read it in the KJV. 1 John 1:9, if we confess our sins, then in the NIV it says he is faithful and just. Psalm 119:105,"), "Psalms 119:105");
  assert.equal(
    read("we read in John 3:16 that God loved the world, now turn to Romans 5 verse 8"),
    "Romans 5:8",
    "the last of two in one sentence",
  );
});

test("a reference said sideways is left to the model, not guessed at", () => {
  // The parser can read a chapter here, and nothing more; the model reads
  // "the 3rd verse".
  assert.equal(read("Turn with me to the book of John chapter 3 and the 3rd verse."), "John 3 (ask)");
  assert.equal(read("Mark 2 people came early"), "Mark 2 (ask)", "a name and a number");
  assert.equal(read("the first thing I want to tell you is that God loves you"), null);
});

test("a verse said on its own is read in the passage just named", () => {
  assert.equal(
    read("Turn with me to the book of John chapter 3 and the 3rd verse. Jesus answered and said unto him, verily, verily, I say unto thee, except a man be born again, he cannot see the kingdom of God. And then look at verse 16."),
    "John 3:16",
  );
  assert.equal(read("And then look at verse 18.", open("John 3:16")), "John 3:18", "or in the one open");
  assert.equal(
    read("Now turn to Habakkuk. Chapter 3, verse 16.", open("Romans 8")),
    null,
    "not in the passage left open when another book was named",
  );
});

test("a reference that may still be being said waits", () => {
  const grows = (text) => {
    const reading = readNewestReference(text, books, nothingOpen);
    return mayStillGrow(text, reading.reference);
  };
  assert.equal(grows("Turn with me to the book of John, chapter 10."), true, "a verse may follow");
  assert.equal(grows("John chapter 3 verse"), true);
  assert.equal(grows("John chapter 3 verse twenty"), true, "twenty-what?");
  assert.equal(grows("Romans 8:28 in the"), true, "the NIV?");
  assert.equal(grows("John 3:16 to"), true, "a range");
  assert.equal(grows("Romans 8:28."), false);
  assert.equal(grows("John chapter 3 and the 3rd verse."), false, "the third verse is said");
  assert.equal(grows("John chapter 3. For God so loved"), false, "the words moved on");
});

test("the model is asked only when something that names a passage changes", () => {
  const words = bookWordsOf(books);
  const cues = (text) => cuesOf(text, words);
  assert.equal(cues("Turn with me to the book of John chapter 3 and the 3rd verse.").worthAsking, true);
  assert.equal(cues("open your Bibles to have a cook 2:3").worthAsking, true, "a misheard book");
  assert.equal(cues("Mark 2 people came early").worthAsking, true);
  assert.equal(cues("Somebody shout amen").worthAsking, false);
  assert.equal(cues("God is good all the time").worthAsking, false);
  assert.equal(
    cues("Romans 8:28. And we know that in all things").key,
    cues("Romans 8:28. And we know that in all things God works for the good").key,
    "the verse being read changes nothing to ask about",
  );
});

const versions = [
  { code: "KJV", name: "King James Version" },
  { code: "NKJV", name: "New King James Version" },
  { code: "NIV", name: "New International Version" },
  { code: "AMP", name: "Amplified Bible" },
  { code: "MSG", name: "The Message" },
];

test("the Bible a preacher names is the one used", () => {
  const named = (text) => findNamedVersion(text, versions);
  assert.equal(named("Romans 8:28 in the New International Version says"), "NIV");
  assert.equal(named("Let's read it in the KJV. 1 John 1:9."), "KJV");
  assert.equal(named("in the k j v it says"), "KJV");
  assert.equal(named("the New King James Version reads"), "NKJV", "not the King James inside it");
  assert.equal(named("in the King James"), "KJV");
  assert.equal(named("Let's read it in the KJV. then in the NIV it says"), "NIV", "the last named");
  assert.equal(named("the Amplified Bible puts it this way"), "AMP");
  assert.equal(named("this is the message of the cross"), null, "a word, not a Bible");
  assert.equal(named("cast your net on the other side"), null);
  assert.equal(named("the Message translation says"), "MSG");
});

test("a verse is known to be inside the passage on screen", () => {
  const shown = open("John 3:16-18");
  assert.equal(passageHolds(shown, { bookId: "john", chapter: 3, verse: 17 }), true);
  assert.equal(passageHolds(shown, { bookId: "john", chapter: 3, verse: 19 }), false);
  assert.equal(passageHolds(open("John 3"), { bookId: "john", chapter: 3, verse: 30 }), true);
  assert.equal(passageHolds(shown, { bookId: "romans", chapter: 3, verse: 17 }), false);
  assert.equal(asLookup(open("John 3:16"), "NIV"), "John 3:16 NIV");
});

test("the turn before is context for a verse, not something to read again", () => {
  const reading = (text, earlier, opened = nothingOpen) => {
    const found = readNewestReference(text, books, opened, earlier);
    return found ? asLookup(found.reference) : null;
  };
  assert.equal(reading("Verse 16.", "Turn with me to John chapter 3."), "John 3:16");
  assert.equal(
    reading("Chapter 3, verse 16.", "Now turn to Habakkuk.", open("Romans 8")),
    null,
    "a book named just before, without a chapter, is the model's to read",
  );
  assert.equal(
    reading("one more thing before we pray", "And then look at verse 16.", open("Romans 5")),
    null,
    "a verse said a turn ago is not read again in whatever is open now",
  );
});

test("a Bible installed under its code is known by its full name", () => {
  // The catalog installs each Bible named by its code alone.
  const installed = ["KJV", "NKJV", "NIV", "ESV", "GNT", "GW", "RSV", "NRSV"].map((code) => ({
    code,
    name: code,
  }));
  const named = (text) => findNamedVersion(text, installed);
  assert.equal(named("read it from the King James"), "KJV");
  assert.equal(named("in the New King James Version it says"), "NKJV");
  assert.equal(named("the New International Version puts it"), "NIV");
  assert.equal(named("the English Standard Version"), "ESV");
  assert.equal(named("the New Revised Standard Version"), "NRSV", "not the RSV inside it");
  assert.equal(named("the Good News Translation"), "GNT");
  assert.equal(named("this is the good news of Jesus"), null, "the gospel, not a Bible");
  assert.equal(named("God's word says we are more than conquerors"), null);
  assert.equal(named("give me KJV"), "KJV");
});

test("the voice service is told the installed Bibles' names to listen for", () => {
  const installed = ["KJV", "ESV", "TPT", "AMPC", "RV"].map((code) => ({ code, name: code }));
  assert.deepEqual(versionKeyterms(installed), [
    "KJV", "King James",
    "ESV", "English Standard",
    "TPT", "Passion Translation",
    "AMPC", "Amplified Classic",
    "RV",
  ]);
});

test("reading along: moving on to the next verse within two words, and only then", () => {
  const john3 = [
    "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
  ].map((text, index) => ({ verse: 16 + index, words: readingWords(text) }));
  const at = (heard) => readingAt(readingWords(heard), john3, 16);
  const moves = (heard) => {
    const found = at(heard);
    const next = john3.find(({ verse }) => verse === found?.verse);
    return found ? movedOn(found, 16, next?.words[0]) && found.verse : false;
  };
  assert.equal(moves("whosoever believeth in him should not perish, but have everlasting life."), false, "still verse 16");
  assert.equal(moves("should not perish, but have everlasting life. For God"), 17, "read straight on: two words");
  assert.equal(moves("should not perish, but have everlasting life. For"), false, "one common word is not enough");
  assert.equal(moves("everlasting life. Amen, church, isn't that good"), false, "talking about it moves nothing");
  assert.equal(moves("Now look. For God sent not"), 17, "after a pause, three words in a row");
  assert.equal(moves("For God"), false, "two words alone could be either");

  const opening = [
    { verse: 1, words: readingWords("The words of the blessed king.") },
    { verse: 2, words: readingWords("Jesus answered and said unto them.") },
  ];
  const found = readingAt(readingWords("the blessed king. Jesus"), opening, 1);
  assert.equal(movedOn(found, 1, "jesus"), true, "one word, when it is not a common opening");
});
