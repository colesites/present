/**
 * The Bible agent, run against the real Bibles in `apps/desktop/bible/`, with
 * speech fed to it the way AssemblyAI streams it: every turn growing a word at
 * a time, the newest word still forming, then the turn ending.
 *
 * Nothing here is a stand-in for the agent's own judgement: the quote finder
 * is the app's (`quotedVerseMatch`, in the Bible in use only, as
 * `useScripture.findQuotedVerseInText` calls it), the chapters read along with
 * are the Bible's own, and references are parsed by the app's parser. Only the
 * model is replaced, by whatever a case or a run says it answers.
 */

import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const here = (path) => new URL(path, import.meta.url);

const load = (path, modules = {}) => {
  const source = readFileSync(here(path), "utf8");
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

const lib = "../../src/features/scripture/lib/";
export const parser = load(`${lib}parser.ts`);
export const listening = load(`${lib}listening.ts`, { "./parser": parser });
const transcriptBuffer = load(`${lib}transcript-buffer.ts`);
const commandParser = load(`${lib}command-parser.ts`, {
  "./parser": parser,
  "./listening": listening,
});
const stepReference = await import(here(`${lib}step-reference.mjs`));
export const verseSearch = await import(here(`${lib}verse-search-index.mjs`));
const optional = (path, modules) => {
  try {
    return load(path, modules);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};
/** Present once the agent reads along by its own module; absent before. */
export const reading = optional(`${lib}reading.ts`, { "./listening": listening });
const heardScripture = load(`${lib}heard-scripture.ts`, {
  "./parser": parser,
  "./listening": listening,
  "./transcript-buffer": transcriptBuffer,
  "./command-parser": commandParser,
  "./step-reference.mjs": stepReference,
  ...(reading ? { "./reading": reading } : {}),
});

const counts = JSON.parse(readFileSync(here(`${lib}canonical-verse-counts.json`), "utf8"));
const countsByName = new Map(
  Object.entries(counts).map(([name, chapters]) => [name.toLowerCase(), chapters]),
);
// As `ScripturePanel` does at start-up.
parser.knowVerseCounts(
  (book, chapter) => countsByName.get(book.trim().toLowerCase())?.[String(chapter)] ?? null,
);

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
const decode = (text) =>
  text.replace(/&(#\d+|\w+);/g, (whole, name) =>
    name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name] ?? whole),
  );

const FILES = { ERV: "EnglishERVBible" };
const bibles = new Map();

/** Books by their number, as `import-pipeline.ts` names them in a file that gives only numbers. */
const STANDARD_BOOKS = (
  "Genesis,Exodus,Leviticus,Numbers,Deuteronomy,Joshua,Judges,Ruth,1 Samuel,2 Samuel,1 Kings,2 Kings,"
  + "1 Chronicles,2 Chronicles,Ezra,Nehemiah,Esther,Job,Psalms,Proverbs,Ecclesiastes,Song of Solomon,"
  + "Isaiah,Jeremiah,Lamentations,Ezekiel,Daniel,Hosea,Joel,Amos,Obadiah,Jonah,Micah,Nahum,Habakkuk,"
  + "Zephaniah,Haggai,Zechariah,Malachi,Matthew,Mark,Luke,John,Acts,Romans,1 Corinthians,2 Corinthians,"
  + "Galatians,Ephesians,Philippians,Colossians,1 Thessalonians,2 Thessalonians,1 Timothy,2 Timothy,"
  + "Titus,Philemon,Hebrews,James,1 Peter,2 Peter,1 John,2 John,3 John,Jude,Revelation"
).split(",");

/**
 * The three ways the Bibles in `apps/desktop/bible/` are written: `<b n>`,
 * `<BIBLEBOOK bnumber bname>` and `<book number>`, each with its chapters
 * and verses.
 */
const FORMATS = [
  {
    book: /<b n="([^"]+)">([\s\S]*?)<\/b>/g,
    chapter: /<c n="(\d+)">([\s\S]*?)<\/c>/g,
    verse: /<v n="(\d+)">([\s\S]*?)<\/v>/g,
    encoding: "latin1",
    opens: "<b n=",
    name: (given) => given,
  },
  {
    book: /<BIBLEBOOK bnumber="(\d+)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/g,
    chapter: /<CHAPTER cnumber="(\d+)">([\s\S]*?)<\/CHAPTER>/g,
    verse: /<VERS vnumber="(\d+)">([\s\S]*?)<\/VERS>/g,
    encoding: "utf8",
    opens: "<BIBLEBOOK ",
    name: (number) => STANDARD_BOOKS[Number(number) - 1],
  },
  {
    book: /<book number="(\d+)"[^>]*>([\s\S]*?)<\/book>/g,
    chapter: /<chapter number="(\d+)">([\s\S]*?)<\/chapter>/g,
    verse: /<verse number="(\d+)">([\s\S]*?)<\/verse>/g,
    encoding: "utf8",
    opens: "<book number=",
    name: (number) => STANDARD_BOOKS[Number(number) - 1],
  },
];

/** One of the Bibles in `apps/desktop/bible/`, as the app's import stores it. */
export function bible(code) {
  const cached = bibles.get(code);
  if (cached) return cached;
  const id = code.toLowerCase();
  const file = here(`../../bible/${FILES[code] ?? code}.xml`);
  const head = readFileSync(file, "latin1").slice(0, 4000);
  const format = FORMATS.find(({ opens }) => head.includes(opens)) ?? FORMATS[0];
  const xml = readFileSync(file, format.encoding);
  const books = [];
  const verses = [];
  const chapters = new Map();
  for (const [, given, bookBody] of xml.matchAll(format.book)) {
    const bookName = format.name(given);
    if (!bookName) continue;
    // `import-pipeline.ts`: the name, lower case, no spaces, eight letters.
    const bookId = bookName.toLowerCase().replace(/\s+/g, "").substring(0, 8);
    let chapterCount = 0;
    for (const [, chapterNumber, chapterBody] of bookBody.matchAll(format.chapter)) {
      const chapter = Number(chapterNumber);
      chapterCount = Math.max(chapterCount, chapter);
      const inChapter = [];
      for (const [, verseNumber, text] of chapterBody.matchAll(format.verse)) {
        const verse = {
          pk: `${id}|${bookId}|${chapter}|${verseNumber}`,
          version: id,
          bookId,
          bookName,
          chapter,
          verse: Number(verseNumber),
          text: decode(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
        };
        verses.push(verse);
        inChapter.push(verse);
      }
      chapters.set(`${bookId}|${chapter}`, inChapter);
    }
    books.push({ pk: `${id}|${bookId}`, version: id, id: bookId, name: bookName, chapters: chapterCount });
  }
  const loaded = {
    code,
    id,
    books,
    verses,
    chapters,
    index: verseSearch.buildVerseSearchIndex(verses),
    verse: (bookName, chapter, verse) =>
      verses.find(
        (candidate) =>
          candidate.bookName === bookName && candidate.chapter === chapter && candidate.verse === verse,
      ) ?? null,
  };
  bibles.set(code, loaded);
  return loaded;
}

const NAMES = {
  KJV: "King James Version",
  NKJV: "New King James Version",
  NIV: "New International Version",
  ESV: "English Standard Version",
  NLT: "New Living Translation",
  AMP: "Amplified Bible",
  MSG: "The Message",
  GNT: "Good News Translation",
  RSV: "Revised Standard Version",
  NRSV: "New Revised Standard Version",
  AMPC: "Amplified Bible Classic",
  ERV: "Easy-to-Read Version",
  TPT: "The Passion Translation",
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A turn's text as the words of a message: the newest still forming. */
const wordsOf = (text, forming) => {
  const words = text.split(/\s+/).filter(Boolean);
  // `final` as `ScripturePanel` hands the service's `word_is_final` on.
  return words.map((word, at) => ({ text: word, final: !(forming && at === words.length - 1) }));
};

/**
 * The messages of one turn, in order: the turn a word longer each time, a
 * number said in two parts ("3:1" on its way to "3:16") seen part-way, and
 * the turn ended.
 */
export function messagesOf(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const messages = [];
  for (let count = 1; count <= words.length; count += 1) {
    const sofar = words.slice(0, count);
    const newest = sofar[count - 1];
    const digits = newest.match(/^(.*\d)(\d)(\D*)$/);
    if (digits && /\d/.test(digits[1])) {
      messages.push({ text: [...sofar.slice(0, -1), digits[1]].join(" "), ended: false });
    }
    // Sentence punctuation comes with the next word, not with this one.
    const forming = count < words.length ? newest.replace(/[.,!?;]+$/, "") : newest;
    messages.push({ text: [...sofar.slice(0, -1), forming].join(" "), ended: false });
  }
  messages.push({ text: words.join(" "), ended: true });
  return messages;
}

/**
 * A Bible tab with the agent listening, as `ScripturePanel` sets it up.
 *
 * `model(heard, open, earlier)`: what the model answers, as
 * `{ reference, confidence?, sure?, story?, intent? }`, or nothing.
 */
export function createTab({
  version = "KJV",
  installed = [...new Set(["KJV", "NKJV", "NIV", version])],
  onHeard = "show",
  model = null,
  open = "",
} = {}) {
  const versions = installed.map((code) => ({ id: code.toLowerCase(), code, name: NAMES[code] ?? code }));
  const tab = {
    box: open,
    chosen: version,
    /** Every passage put on screen, in order. */
    screen: [],
    /** Every passage put in the box, in order. */
    found: [],
    notes: [],
    asked: [],
    turn: 0,
  };
  // Every book of the Bible, whichever Bible is chosen: a New Testament alone
  // (the Passion Translation) is still asked for Genesis.
  const books = bible(version).books.length >= 66 ? bible(version).books : bible("KJV").books;
  const settings = () => {
    const chosen = bible(tab.chosen);
    return {
      enabled: true,
      onHeard,
      addToService: true,
      books,
      versions,
      catalog: [],
      install: async () => false,
      chosenVersionCode: tab.chosen,
      openPassage: () => parser.parseReference(tab.box, books),
      fill: (lookup) => {
        tab.box = lookup;
        tab.found.push(lookup);
      },
      show: (lookup) => {
        tab.screen.push(lookup);
        // As the panel does: what is shown is what is open.
        tab.box = lookup.replace(/\s+[A-Z]{2,5}$/, "");
      },
      chooseVersion: (code) => {
        tab.chosen = code;
        agent.update(settings());
      },
      understand: model
        ? async (heard, earlier, openPassage) => {
            tab.asked.push(heard);
            const answer = await model(heard, openPassage, earlier);
            if (!answer) return null;
            const confidence = answer.confidence ?? (answer.sure === false ? 0.7 : 1);
            const intent = answer.intent ?? "SCRIPTURE_READING";
            return {
              reference: parser.parseReference(answer.reference, books),
              confidence,
              // `Understanding::may_project` in `services/scripture_agent.rs`.
              mayProject:
                confidence >= 0.9
                && (intent === "SCRIPTURE_READING"
                  || intent === "NAVIGATION_REQUEST"
                  || (intent === "UNCERTAIN" && (Boolean(answer.story) || confidence >= 0.95))),
              story: Boolean(answer.story),
              intent,
            };
          }
        : null,
      // `useScripture.findQuotedVerseInText`, in the chosen Bible only.
      findQuotedVerse: async ({ query, endingWithin, ended, suggest }) => {
        if (verseSearch.normalizeVerseSearchText(query).length < 3) return null;
        const match = verseSearch.quotedVerseMatch(chosen.index, query, { endingWithin, ended, suggest });
        if (!match) return null;
        return match.sure
          ? match.verse
          : { ...match.verse, suggested: { fromEnd: match.fromEnd, rivals: match.rivals } };
      },
      versionCodeOf: (id) => id.toUpperCase(),
      readChapter: async (book, chapter, versionCode) =>
        (bible(versionCode ?? tab.chosen).chapters.get(`${book.id}|${chapter}`) ?? []).map(
          ({ verse, text }) => ({ verse, text }),
        ),
      note: (event, detail) => tab.notes.push(`${event}: ${detail}`),
    };
  };
  const agent = heardScripture.createHeardScripture(settings());
  let clock = 1_000_000;

  /** One message from the stream. */
  tab.message = async (text, ended) => {
    agent.update(settings());
    clock += 300;
    agent.hear({
      session: 1,
      turn: tab.turn,
      transcript: text,
      endOfTurn: ended,
      words: wordsOf(text, !ended),
      receivedAt: clock,
    });
    await settle();
    await settle();
    if (ended) tab.turn += 1;
  };

  /** A whole turn, said a word at a time and then ended. */
  tab.say = async (text) => {
    for (const { text: sofar, ended } of messagesOf(text)) {
      await tab.message(sofar, ended);
    }
  };

  /** What is on screen now, without the Bible's code: "John 3:16". */
  tab.showing = () => tab.screen.at(-1)?.replace(/\s+[A-Z]{2,5}$/, "") ?? null;
  return tab;
}

export const withoutVersion = (lookup) => lookup.replace(/\s+[A-Z]{2,5}$/, "");
