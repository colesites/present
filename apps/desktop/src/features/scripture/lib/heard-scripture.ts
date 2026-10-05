/**
 * The Bible agent: what the preacher says, read as it is said.
 *
 * AssemblyAI sends the words of each turn as they grow — at every short pause
 * with Universal-3.5 Pro, a turn ending after half a second of quiet — and
 * every time they come, three things read them:
 *
 * - **the parser**, here and at once, for a passage written so it can be
 *   nothing else ("Romans 8:28", "chapter 3 verse 16", "verse 18" within the
 *   passage just named). These go on screen with no round trip.
 * - **the model** (`services/scripture_agent.rs`), for everything else: a
 *   passage said sideways ("the book of John chapter 3 in the 3rd verse"), a
 *   misheard book, a story told ("David took five smooth stones"). It is sent
 *   the last few seconds of speech at once whenever what names a passage in
 *   them changes, and otherwise every dozen words or so, and when a turn
 *   ends — not once a sentence is finished.
 * - **the quote finder**, for a verse being read aloud, in whichever
 *   installed Bible it is being read from.
 *
 * The Bible a preacher names ("in the NIV", "King James") or reads from is
 * the one the tab switches to and the passage is shown in.
 *
 * Find it puts what was heard in the Bible tab's box. Show it puts it on
 * screen too — when the parser read it plainly or the model is sure, and once
 * the words show the reference was finished ("John chapter 3" may be going on
 * to "verse 16").
 *
 * React-free, so it can be heard in a test (`hooks/useHeardScripture.ts`
 * gives it to the Bible tab).
 */

import type { BibleBookRecord, BibleVerse } from "./db";
import {
  asLookup,
  bookWordsOf,
  cuesOf,
  findNamedVersion,
  lastWords,
  mayStillGrow,
  movedOn,
  passageHolds,
  readingAt,
  readingWords,
  readNewestReference,
  type NamedVersion,
} from "./listening";
import type { ParsedReference } from "./parser";

export type HeardScriptureInput = {
  /** Whether to read what is heard at all: the Bible tab is the one open. */
  enabled: boolean;
  onHeard: "show" | "find";
  addToService: boolean;
  /** The books of the Bible the tab is in. */
  books: BibleBookRecord[];
  versions: NamedVersion[];
  /** The Bibles in the catalog that are not installed yet. */
  catalog: NamedVersion[];
  /**
   * Download one of them, as choosing it in the Bible menu does; whether it
   * is installed now.
   */
  install: (code: string) => Promise<boolean>;
  /** The Bible the tab is in. */
  chosenVersionCode: string | null;
  /** The passage in the Bible tab's box. */
  openPassage: () => ParsedReference;
  /** Put a reference in the box, as the operator would type it. */
  fill: (lookup: string) => void;
  /** Put a reference on screen. */
  show: (lookup: string, options: { addToService: boolean }) => void;
  /** Switch the tab to another installed Bible. */
  chooseVersion: (code: string) => void;
  /**
   * Ask the model what the words new since it was last asked mean, with what
   * was said before them and the passage open in the tab; `null` when it
   * cannot be asked (nobody signed in).
   */
  understand:
    | ((
        heard: string,
        earlier: string,
        openPassage: string | null,
      ) => Promise<{
        reference: ParsedReference;
        confidence: number;
        mayProject: boolean;
        story: boolean;
      } | null>)
    | null;
  findQuotedVerse: (input: {
    query: string;
    versionCode: string | null;
    versions: "indexed" | "all";
    endingWithin: number;
  }) => Promise<BibleVerse | null>;
  /** The code of an installed Bible, from its id. */
  versionCodeOf: (versionId: string) => string;
  /** The verses of a chapter, in a Bible, to read along with. */
  readChapter: (
    book: BibleBookRecord,
    chapter: number,
    versionCode: string | null,
  ) => Promise<{ verse: number; text: string }[]>;
  /** Write what was heard and done to the app's log. */
  note?: (event: string, detail: string) => void;
};

/** As much of what was said as the version named is looked for in. */
const HEARD_WORDS = 50;
/**
 * As much of what came before the new words as the model is sent, to
 * understand them by: about ten seconds.
 */
const EARLIER_WORDS = 36;
/** As much of a turn as a quote is looked for in. */
const QUOTE_WORDS = 40;
/** A quote counts when it ends this close to the newest word. */
const QUOTE_ENDS_WITHIN = 3;
/**
 * How many new words make it worth asking the model again about what is
 * being said, for a story: about four seconds of a fast preacher. Each ask is
 * about 700 tokens, so this is what decides how far a plan's allowance goes.
 */
const STORY_EVERY_WORDS = 12;
/**
 * At the end of a turn, as few new words as this are asked about: "In the
 * beginning", said alone, is Genesis 1:1 to the model, and is three words.
 */
const STORY_LEAST_WORDS = 2;

type Passage = {
  reference: ParsedReference;
  version: string | null;
  /** The passage and Bible together, to tell one from another. */
  key: string;
};

type QuoteCheck = { text: string; final: boolean; version: string | null; step: number };

const fresh = () => ({
  /** The turn before this one. */
  earlier: "",
  turn: 0,
  /** This turn's words so far. */
  text: "",
  ended: false,
  /** What in this turn names a passage, as it stood last time. */
  cueKey: "",
  /** Counts each change of that, so an answer can tell it has been overtaken. */
  step: 0,
  /** How many of this turn's words the model had been asked about. */
  askedWords: 0,
  /** Counts the questions put to the model, and the newest one answered. */
  asks: 0,
  answered: 0,
  /** The newest step anything has been taken from. */
  takenStep: -1,
  /** The Bible last named in what was heard. */
  named: null as string | null,
  /** The last passage put in the box or on screen. */
  current: null as Passage | null,
  /** The last passage put on screen. */
  shown: null as Passage | null,
  /**
   * Sure, and waiting for the words to show it was finished — until words
   * that name a passage change (`step`), when it is not what is being said.
   */
  held: null as { passage: Passage; step: number } | null,
  quoting: false,
  nextQuote: null as QuoteCheck | null,
  /** The last verse read aloud that was acted on. */
  quoted: "",
  /**
   * A Bible asked for that is not installed, being downloaded: the passage
   * in view goes into it once it is.
   */
  awaiting: null as string | null,
  /** One whose download failed, not tried again until it is asked for again. */
  declined: null as string | null,
  /** The chapter of the passage in view, to read along with. */
  chapter: null as { key: string; verses: { verse: number; words: string[] }[] | null } | null,
  /** The newest words, for reading along once the chapter has loaded. */
  heard: "",
});

type State = ReturnType<typeof fresh>;

export function createHeardScripture(first: HeardScriptureInput): {
  /** Read the words of the turn so far; `isFinal` once the turn is over. */
  hear: (transcript: string, isFinal: boolean) => void;
  /** Start again: listening stopped. */
  forget: () => void;
  /** What the Bible tab is showing now: its books, its Bible, its settings. */
  update: (input: HeardScriptureInput) => void;
} {
  let current = first;
  const input = () => current;
  let state: State = fresh();
  let bookWords = { books: [] as BibleBookRecord[], words: new Set<string>() };
  const bookWordsFor = (books: BibleBookRecord[]) => {
    if (bookWords.books !== books) bookWords = { books, words: bookWordsOf(books) };
    return bookWords.words;
  };

  /** Put on screen, unless it is already. */
  const project = (s: State, passage: Passage, following = false) => {
    if (s.shown?.key === passage.key) return;
    // The same verses in another Bible are one item in the service, not two;
    // and the verses a passage is read on into belong to the item already
    // there.
    const sameVerses =
      s.shown !== null && asLookup(s.shown.reference) === asLookup(passage.reference);
    s.shown = passage;
    const now = input();
    now.note?.("shown", asLookup(passage.reference, passage.version));
    now.show(asLookup(passage.reference, passage.version), {
      addToService: now.addToService && !sameVerses && !following,
    });
  };

  /** The chapter of the passage in view, loaded once, to read along with. */
  const chapterKey = ({ reference, version }: Passage) =>
    `${reference.book?.id ?? ""}|${reference.chapter ?? ""}|${version ?? ""}`;
  const loadChapter = (s: State, passage: Passage) => {
    const { book, chapter } = passage.reference;
    if (!book || !chapter) return;
    const key = chapterKey(passage);
    if (s.chapter?.key === key) return;
    const loading: NonNullable<State["chapter"]> = { key, verses: null };
    s.chapter = loading;
    void input()
      .readChapter(book, chapter, passage.version)
      .then((verses) => {
        loading.verses = verses.map(({ verse, text }) => ({ verse, words: readingWords(text) }));
        // Reading may have gone on while it loaded.
        if (s === state && s.chapter === loading) follow(s, s.heard);
      })
      .catch((): void => undefined);
  };

  /** Act on a passage heard at `step`, unless something newer was. */
  const take = (
    s: State,
    reference: ParsedReference,
    {
      sure,
      step,
      version,
      following = false,
    }: { sure: boolean; step: number; version: string | null; following?: boolean },
  ) => {
    if (s !== state || step < s.takenStep) return;
    s.takenStep = step;
    const now = input();
    const passage: Passage = {
      reference,
      version,
      key: `${asLookup(reference)}|${version ?? ""}`,
    };
    if (s.current?.key !== passage.key) {
      s.current = passage;
      loadChapter(s, passage);
      // In the box as the operator would type it: the Bible only when it is
      // not the one the tab is in, so choosing another still works.
      const lookup = asLookup(reference, version !== now.chosenVersionCode ? version : null);
      now.note?.("found", lookup);
      now.fill(lookup);
    }
    // A chapter alone is not put on screen: that is its first verse, which
    // nobody asked for — a preacher who says "Revelation chapter 1" may be
    // going on to verse 5. It waits in the box for the verse said, or read.
    if (now.onHeard !== "show" || !sure || reference.verseStart === null) {
      s.held = null;
      return;
    }
    // A reference being named may not be finished ("John 3:16 to…"); a
    // verse being read into is there already.
    if (!following && !s.ended && mayStillGrow(s.text, reference)) {
      s.held = { passage, step: s.step };
      return;
    }
    s.held = null;
    project(s, passage, following);
  };

  /**
   * Read along with the passage in view: the verse being read, as soon as the
   * reading moves on to it (`movedOn`). Whether the newest words are this
   * passage's, being read — and so not a quote of anything else.
   */
  const follow = (s: State, heard: string): boolean => {
    const current = s.current;
    const loaded = s.chapter;
    const { book, chapter, verseStart, verseEnd } = current?.reference ?? {};
    if (!current || !book || !chapter || verseEnd !== null) return false;
    if (!loaded?.verses || loaded.key !== chapterKey(current)) return false;
    const inView = verseStart ?? null;
    const from = inView ?? 1;
    const to = inView === null ? 8 : inView + 3;
    const verses = loaded.verses.filter(({ verse }) => verse >= from && verse <= to);
    const at = readingAt(readingWords(lastWords(heard, 24)), verses, inView);
    if (!at) return false;
    const reading = verses.find(({ verse }) => verse === at.verse);
    if (!movedOn(at, inView, reading?.words[0])) return at.matched >= 3;
    // A new step: answers asked about the verse left behind are not acted on.
    s.step += 1;
    input().note?.("reading on", `${book.name} ${chapter}:${at.verse}`);
    take(
      s,
      { book, chapter, verseStart: at.verse, verseEnd: null, versionCode: null, errors: [] },
      { sure: true, step: s.step, version: current.version, following: true },
    );
    return true;
  };

  const ask = (
    s: State,
    { heard, earlier }: { heard: string; earlier: string },
    { open, named, step }: {
      /** The passage open in the tab when the words were heard. */
      open: ParsedReference;
      /** What the parser could read in them, if anything. */
      named: ParsedReference | null;
      step: number;
    },
  ) => {
    const now = input();
    if (!now.understand) return;
    const asked = ++s.asks;
    void now
      .understand(heard, earlier, open.book ? asLookup(open) : null)
      .then((understood) => {
        // Below 0.5 the model says it is guessing.
        if (!understood?.reference.book || understood.confidence < 0.5) return;
        // Answers race back. One to words since heard again — "and have mercy
        // on those who die", on the way to "… who doubt" — is not the newest,
        // however late it arrives.
        if (asked < s.answered) return;
        s.answered = asked;
        // A story goes on being told: once its passage is in view, the
        // verses it moves through are the same passage, not new ones to show.
        if (understood.story) {
          const chapterOf = (reference: ParsedReference | undefined) =>
            reference?.book ? `${reference.book.id} ${reference.chapter}` : null;
          const told = chapterOf(understood.reference);
          if (told === chapterOf(s.current?.reference) || told === chapterOf(open)) return;
        }
        // Words that name no passage are answered with the open one, at full
        // confidence: "John said one thing to the crowd that day", with John
        // 3:16 open, was John 3:16 at 1. Only when the words themselves name
        // its book and chapter is it the open passage being said again.
        const echo =
          asLookup(understood.reference) === asLookup(open)
          && !(
            named?.book?.id === understood.reference.book.id
            && named.chapter === understood.reference.chapter
          );
        if (echo) return;
        // An answer comes a second or more after it was asked, five once when
        // Groq was resting: the Bible in use may have changed since. The
        // verses already on screen, or in the box, are not put up again for
        // it — Genesis 1:1 went up in the KJV, the ESV, and the KJV again —
        // and anything new is in the Bible in use now.
        const answered = input();
        const same = (passage: Passage | null) =>
          passage !== null && asLookup(passage.reference) === asLookup(understood.reference);
        if (same(s.shown) || (answered.onHeard === "find" && same(s.current))) return;
        const version = same(s.current)
          ? (s.current?.version ?? null)
          : (s.named ?? answered.chosenVersionCode);
        take(s, understood.reference, { sure: understood.mayProject, step, version });
      })
      .catch((): void => {
        // Offline, refused, or too many requests this minute: the parser and
        // the operator carry on (`scripture_agent::ask` logs which).
      });
  };

  const quote = (s: State, first: QuoteCheck) => {
    const look = (check: QuoteCheck) => {
      s.quoting = true;
      void input()
        .findQuotedVerse({
          query: lastWords(check.text, QUOTE_WORDS),
          // A Bible that matches as far as the one in view does not displace it.
          versionCode: s.current?.version ?? check.version,
          versions: check.final ? "all" : "indexed",
          endingWithin: QUOTE_ENDS_WITHIN,
        })
        .then((verse) => {
          if (!verse || s !== state || verse.pk === s.quoted) return;
          s.quoted = verse.pk;
          const now = input();
          const version = now.versionCodeOf(verse.version);
          if (version !== now.chosenVersionCode) now.chooseVersion(version);
          const inView = s.current;
          if (inView && passageHolds(inView.reference, verse)) {
            // The passage in view, read from another Bible: shown in that one.
            if (inView.version !== version) {
              take(s, inView.reference, { sure: true, step: check.step, version });
            }
            return;
          }
          const book = now.books.find((candidate) => candidate.id === verse.bookId);
          if (!book) return;
          take(
            s,
            {
              book,
              chapter: verse.chapter,
              verseStart: verse.verse,
              verseEnd: null,
              versionCode: null,
              errors: [],
            },
            { sure: true, step: check.step, version },
          );
        })
        .catch((): void => undefined)
        .finally(() => {
          s.quoting = false;
          const next = s.nextQuote;
          s.nextQuote = null;
          if (next && s === state) look(next);
        });
    };
    // One look at a time, then the newest words: they can come ten times a
    // second, and each look reads every installed Bible.
    if (s.quoting) {
      s.nextQuote = first;
      return;
    }
    look(first);
  };

  /** A Bible asked for has arrived: the passage in view, in it. */
  const arrived = (s: State, code: string) => {
    if (s !== state || s.awaiting !== code) return;
    s.awaiting = null;
    const now = input();
    now.note?.("Bible installed", code);
    if (code !== now.chosenVersionCode) now.chooseVersion(code);
    const inView = s.current;
    if (inView && inView.version !== code) {
      take(s, inView.reference, {
        sure: s.shown?.key === inView.key,
        step: s.step,
        version: code,
      });
    }
  };

  const hear = (transcript: string, isFinal: boolean) => {
    const now = input();
    const text = transcript.trim();
    if (!now.enabled || !text) return;
    const s = state;

    // AssemblyAI starts each turn's words again from nothing.
    if (s.ended && !text.startsWith(s.text)) {
      s.earlier = s.text;
      s.turn += 1;
      s.askedWords = 0;
    }
    s.text = text;
    s.ended = isFinal;
    const heard = lastWords(`${s.earlier} ${text}`, HEARD_WORDS);
    s.heard = heard;

    // Any Bible the tab offers: the ones installed, and the catalog's.
    const asked = findNamedVersion(heard, [...now.versions, ...now.catalog]);
    const installed = (code: string | null) =>
      code !== null && now.versions.some((version) => version.code === code);
    if (asked !== s.declined) s.declined = null;
    if (asked && !installed(asked) && asked !== s.awaiting && asked !== s.declined) {
      // "Give me in KJV" with only the ESV installed: downloaded, as the
      // Bible menu would, and the passage goes into it when it arrives.
      s.awaiting = asked;
      now.note?.("Bible named, downloading", asked);
      void now
        .install(asked)
        .catch(() => false)
        .then((done) => {
          // The download said why it failed, in a toast; the words still
          // naming it are not a reason to try again at once.
          if (!done && s === state && s.awaiting === asked) {
            s.awaiting = null;
            s.declined = asked;
          }
        });
    }
    const named = installed(asked) ? asked : null;
    if (isFinal) {
      // With what it knew: "give me in KJV" went unanswered with no way to
      // tell whether the KJV was among the Bibles it was given.
      now.note?.(
        "heard",
        `${text} [Bible named: ${asked ?? "none"}; in view: ${s.current ? asLookup(s.current.reference, s.current.version) : "nothing"}; installed: ${now.versions.map((version) => version.code).join(" ") || "none"}; to download: ${now.catalog.length}]`,
      );
    }
    const newlyNamed = named !== null && named !== s.named;
    if (named !== s.named) {
      s.named = named;
      if (named) now.note?.("Bible named", named);
      if (named && named !== now.chosenVersionCode) now.chooseVersion(named);
    }
    const version = named ?? now.chosenVersionCode;

    const cues = cuesOf(text, bookWordsFor(now.books));
    const cueKey = `${s.turn}|${cues.key}|${named ?? ""}`;
    const turnWords = text.split(/\s+/);
    const words = turnWords.length;
    // The words new since the model was last asked, and what came before
    // them. Told apart, it answers what is being said now: sent as one, it
    // went on answering David and Goliath through the prodigal son told
    // straight after it.
    const newWords = () => {
      const from = Math.max(0, Math.min(s.askedWords, words - STORY_EVERY_WORDS));
      return {
        heard: turnWords.slice(from).join(" "),
        earlier: lastWords(`${s.earlier} ${turnWords.slice(0, from).join(" ")}`, EARLIER_WORDS),
      };
    };
    let read = false;
    let reading: ReturnType<typeof readNewestReference> = null;
    if (cueKey !== s.cueKey) {
      s.cueKey = cueKey;
      s.step += 1;
      // "John, chapter 10." was waiting for a verse; "John chapter 3 and
      // the 3rd verse" is what was being said.
      s.held = null;
      // As it was before these words put anything in the box.
      const open = now.openPassage();
      reading = readNewestReference(text, now.books, open, s.earlier);
      if (reading) {
        take(s, reading.reference, { sure: reading.plain, step: s.step, version });
      }
      read = Boolean(reading?.plain);
      if (read) {
        // Read already: the model is not asked about these words again.
        s.askedWords = words;
      } else if (cues.worthAsking) {
        ask(s, newWords(), { open, named: reading?.reference ?? null, step: s.step });
        s.askedWords = words;
      }
    }
    // "Give me KJV": the passage in view, in the Bible just named.
    const inView = s.current;
    if (newlyNamed && !reading && inView && inView.version !== named) {
      take(s, inView.reference, {
        sure: s.shown?.key === inView.key,
        step: s.step,
        version: named,
      });
    }
    // Nothing that names a passage, but the preacher may be telling one.
    const unasked = words - s.askedWords;
    if (!read && (unasked >= STORY_EVERY_WORDS || (isFinal && unasked >= STORY_LEAST_WORDS))) {
      ask(s, newWords(), { open: now.openPassage(), named: null, step: s.step });
      s.askedWords = words;
    }
    // A sure passage waiting on the words: these may show it was finished.
    const held = s.held;
    if (held && (isFinal || !mayStillGrow(text, held.passage.reference))) {
      s.held = null;
      project(s, held.passage);
    }

    // Being read from the passage in view, the words are that, not a quote
    // of anything else to look for.
    if (!follow(s, heard)) quote(s, { text, final: isFinal, version, step: s.step });
  };

  return {
    hear,
    forget: () => {
      state = fresh();
    },
    update: (next) => {
      current = next;
      const s = state;
      const code = s.awaiting;
      if (code && next.versions.some((version) => version.code === code)) {
        // After the Bible tab has caught up with it, so the passage is looked
        // up in a Bible it knows it has.
        setTimeout(() => arrived(s, code), 0);
      }
    },
  };
}
