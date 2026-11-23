/**
 * The Real-Time Bible Agent: what the preacher says, read and acted on in real-time.
 *
 * Architecture & Core Invariants:
 * 1. TWO OPERATIONAL MODES:
 *    - SHOW IT: Automatically projects scripture to the church screen when verified criteria
 *      are satisfied (verified explicit navigation commands, high-confidence sequential reading,
 *      or high-confidence SCRIPTURE_READING intent). Anything less sure is SUGGESTED: put in
 *      the box for the operator to show or pass over — the model under 0.9, or sure of what
 *      the words do not bear out; the first words of a verse ("In the beginning"), which go
 *      up once the rest is said, after a pause or not word for word (`bearsOutSuggestion`).
 *    - FIND IT: Strictly suggestions only. Updates the Bible tab / box.
 *      The screen NEVER changes automatically in FIND IT mode.
 *
 * 2. HARD TRANSLATION LOCK:
 *    - Selected Bible translation (chosenVersionCode) remains active unless an explicit,
 *      recognized version-change command is issued ("switch to NIV", "read in King James")
 *      or the operator manually selects it.
 *    - A text match in another translation or an LLM score NEVER switches the translation.
 *
 * 3. TRANSCRIPT CONTINUITY:
 *    - Utilizes TranscriptBuffer to persist finalized words across AssemblyAI turns and pauses.
 *    - A pause between "In the beginning" and "God created..." does not drop context.
 *    - Sliding windows span turn boundaries.
 *
 * 4. DETERMINISTIC COMMAND PRECEDENCE:
 *    - Recognizes explicit commands ("next verse", "previous verse", "turn to Romans 8:28",
 *      "show verse 12", "switch to NIV") deterministically before verse matching or LLM.
 *
 * 5. A VERSE BEING READ IS HELD TO (`reading.ts`):
 *    - While the newest words are still those of the passage on screen, or of the verse
 *      after it, nothing found by its words alone — a quote, the model's reading — takes
 *      the screen. A reference said in full still does. The next verse goes up when the
 *      reading reaches it, and not before.
 *
 * 6. THE MODEL PROPOSES; THE BIBLE DECIDES:
 *    - A passage the model names is shown only when what was said bears it out: the
 *      reference was said (its book and numbers are in the words), or the words are the
 *      verse's own, read or told. However sure the model is, "one day a man" is in no verse.
 *    - A passage that is not in the Bible ("John 3:37") is never shown.
 *
 * 7. LLM FOR SEMANTIC AMBIGUITY ONLY:
 *    - Routine sequential reading is handled locally without LLM calls.
 *    - LLM classifies intent (SCRIPTURE_READING, COMMENTARY, REFERENCE_MENTION, NAVIGATION_REQUEST, UNCERTAIN).
 *    - Commentary or casual reference mentions ("As Paul says in Romans 8:28...") NEVER project in SHOW IT mode.
 *    - Stale in-flight LLM decisions are associated with transcript revisions and rejected if superseded.
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
  saysReference,
  wordsAfterLastCue,
  type NamedVersion,
} from "./listening";
import { passageExists, verseCouldGrow, type ParsedReference } from "./parser";
import {
  bearsOutSuggestion,
  borneOutBy,
  followed,
  followingStill,
  goneOnTo,
  mostlyIn,
  rootOf,
  rootsOf,
  stillIn,
} from "./reading";
import {
  createTranscriptBuffer,
  DEFAULT_RETENTION,
  textOf,
  type TranscriptEvent,
} from "./transcript-buffer";
import { findStepCommand, parseExplicitCommand } from "./command-parser";
import { stepPassage } from "./step-reference.mjs";

export type SpeechIntent =
  | "SCRIPTURE_READING"
  | "COMMENTARY"
  | "REFERENCE_MENTION"
  | "NAVIGATION_REQUEST"
  | "UNCERTAIN";

/**
 * A verse found by the words heard. `suggested` when they only begin it, or
 * begin several verses and it is the best known of them: for the box, never
 * the screen, until more words bear it out (`bearsOutSuggestion`).
 */
export type QuotedVerse = BibleVerse & {
  suggested?: {
    /** How many of the newest words heard it was found by. */
    fromEnd: number;
    /** The other verses those words begin as well. */
    rivals: BibleVerse[];
  };
};

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
  /** Whether "next verse" and "previous verse" said aloud are acted on. Default: yes. */
  commands?: boolean;
  /**
   * Step from the verse on screen, when the box does not say which verse that
   * is (a whole chapter is open, and the operator clicked a verse of it).
   */
  step?: (direction: "next" | "previous") => void;
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
        intent?: SpeechIntent;
      } | null>)
    | null;
  findQuotedVerse: (input: {
    query: string;
    versionCode: string | null;
    /** The Bible in use only: the agent never reads the others (`quote`). */
    versions: "chosen";
    endingWithin: number;
    /** Whether the turn is over: a short verse waits for its full stop until then. */
    ended: boolean;
    /** A verse the words only begin to quote, as well, marked `suggested`. */
    suggest?: boolean;
  }) => Promise<QuotedVerse | null>;
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

/** Words looked for in recent speech when parsing references or named version. */
const HEARD_WORDS = 50;
/** Words sent to LLM context before the newest segment. */
const EARLIER_WORDS = 36;
/** Words analyzed for quote matching. */
const QUOTE_WORDS = 40;
/** A quote counts when it ends this close to the newest word. */
const QUOTE_ENDS_WITHIN = 3;
/** Threshold of new words to trigger semantic ambiguity model query. */
const STORY_EVERY_WORDS = 12;
/** End of turn minimum words for LLM query. */
const STORY_LEAST_WORDS = 2;

type Passage = {
  reference: ParsedReference;
  version: string | null;
  /** The passage and Bible together, to tell one from another. */
  key: string;
};

type QuoteCheck = { text: string; final: boolean; version: string | null; step: number };

/** A chapter as it is read aloud: each verse's words, and their roots (`reading.ts`). */
type Script = { verse: number; words: string[]; roots: string[] }[];

/** How many words after a verse goes up are taken to be its own, whatever they are. */
const JUST_UP = 6;

/** The most other Bibles a chapter is read along in. */
const OTHER_BIBLES = 8;

/** Words heard after a suggestion before it is left to the operator alone. */
const SUGGESTION_WORDS = 40;

const fresh = () => ({
  session: 0,
  turn: 0,
  /** This turn's words so far. */
  text: "",
  ended: false,
  /**
   * The newest word is a number still being said: "3:1" on its way to
   * "3:16". A passage ending in it waits for the word, or the next one.
   */
  growing: false,
  /** What in this turn names a passage, as it stood last time. */
  cueKey: "",
  /** Counts each change of state, so an in-flight answer knows if it was overtaken. */
  step: 0,
  /** How many words of transcript the model had been asked about. */
  askedWords: 0,
  /** Counts questions put to the model, and the newest one answered. */
  asks: 0,
  answered: 0,
  /** The newest step anything has been taken from. */
  takenStep: -1,
  /** The Bible explicitly named in a version change command. */
  named: null as string | null,
  /** The last passage put in the box or on screen. */
  current: null as Passage | null,
  /** When it was put there, to tell it from what the operator has opened since. */
  currentAt: 0,
  /**
   * Where in everything heard it was put there: the words before are the
   * reference that named it, or the verse read before it. Only the words
   * since say where its reading is, or quote another verse.
   */
  currentFrom: 0,
  /** Where everything heard ends now, as a count of words (`TranscriptBuffer` positions). */
  heardEnd: 0,
  /**
   * A passage suggested in the box and not shown — the model was not sure of
   * it, or the words did not bear it out, or they only began it: the
   * operator's to show. Nothing is said within it.
   */
  suggested: "",
  /**
   * A suggestion found by its first words, waiting for the rest
   * (`bearsOutSuggestion`): where in everything heard those words began, and
   * the roots of the verse and of the others they begin.
   */
  suggestion: null as {
    reference: ParsedReference;
    from: number;
    roots: string[];
    rivals: string[][];
  } | null,
  /** The turn "next verse" was last acted on in, and how many of its words that took up. */
  steppedTurn: -1,
  steppedWords: 0,
  /** The last passage put on screen. */
  shown: null as Passage | null,
  /**
   * Sure, and waiting for the words to show it was finished — until words
   * that name a passage change (`step`).
   */
  held: null as { passage: Passage; step: number } | null,
  quoting: false,
  nextQuote: null as QuoteCheck | null,
  /** The last verse read aloud that was acted on. */
  quoted: "",
  /**
   * A Bible asked for that is not installed, being downloaded.
   */
  awaiting: null as string | null,
  /** One whose download failed, not tried again until asked again. */
  declined: null as string | null,
  /** The chapter of the passage in view, to read along with. */
  chapter: null as {
    key: string;
    /** In the Bible on screen. */
    verses: Script | null;
    /**
     * The same chapter in the other Bibles installed: what the reader may be
     * reading from. Only to know which verse the reading is in — the screen
     * stays in the Bible chosen.
     */
    others: Script[];
  } | null,
  /** The newest words, for reading along once the chapter has loaded. */
  heard: "",
});

type State = ReturnType<typeof fresh>;

/**
 * Whether the passage is still being said: its verse is the number the
 * speaker is in the middle of, and one more digit would make it another verse
 * of the chapter. "John 3:1" while "sixteen" is being said waits a moment;
 * "John 3:16" and "Psalm 23:1" cannot grow, and go up at once.
 */
const stillSaying = (s: State, reference: ParsedReference): boolean => {
  if (!s.growing) return false;
  const verse = reference.verseEnd ?? reference.verseStart;
  if (!reference.book || !reference.chapter || verse === null) return true;
  return verseCouldGrow(reference.book, reference.chapter, verse);
};

export function createHeardScripture(first: HeardScriptureInput): {
  /** Read the words of the turn so far; `isFinal` once the turn is over. */
  hear: (input: string | TranscriptEvent, isFinal?: boolean) => void;
  /** Start again: listening stopped. */
  forget: () => void;
  /** What the Bible tab is showing now: its books, its Bible, its settings. */
  update: (input: HeardScriptureInput) => void;
} {
  let current = first;
  const input = () => current;
  let state: State = fresh();
  let bookWords = { books: [] as BibleBookRecord[], words: new Set<string>() };
  const buffer = createTranscriptBuffer(DEFAULT_RETENTION);

  const bookWordsFor = (books: BibleBookRecord[]) => {
    if (bookWords.books !== books) bookWords = { books, words: bookWordsOf(books) };
    return bookWords.words;
  };

  /** Put on screen, ONLY if SHOW IT mode is active. Never in FIND IT mode! */
  const project = (s: State, passage: Passage, following = false) => {
    const now = input();
    // HARD INVARIANT: Under no circumstance can the screen change automatically in FIND IT mode!
    if (now.onHeard !== "show") return;

    if (s.shown?.key === passage.key) return;
    const sameVerses =
      s.shown !== null && asLookup(s.shown.reference) === asLookup(passage.reference);
    s.shown = passage;
    now.note?.("shown", asLookup(passage.reference, passage.version));
    now.show(asLookup(passage.reference, passage.version), {
      addToService: now.addToService && !sameVerses && !following,
    });
  };

  /** The chapter of the passage in view, loaded once, to read along with. */
  const chapterKey = ({ reference, version }: Passage) =>
    `${reference.book?.id ?? ""}|${reference.chapter ?? ""}|${version ?? ""}`;

  const asScript = (verses: { verse: number; text: string }[]): Script =>
    verses.map(({ verse, text }) => {
      const words = readingWords(text);
      return { verse, words, roots: words.map(rootOf) };
    });

  const loadChapter = (s: State, passage: Passage) => {
    const { book, chapter } = passage.reference;
    if (!book || !chapter) return;
    const key = chapterKey(passage);
    if (s.chapter?.key === key) return;
    const loading: NonNullable<State["chapter"]> = { key, verses: null, others: [] };
    s.chapter = loading;
    const now = input();
    void now
      .readChapter(book, chapter, passage.version)
      .then((verses) => {
        loading.verses = asScript(verses);
        // Reading may have progressed while chapter was loading.
        if (s === state && s.chapter === loading) follow(s);
      })
      .catch((): void => undefined);
    // The chapter in the other Bibles installed, for a preacher reading from
    // one that is not on screen. One chapter of each, once, when the passage
    // goes up — not every Bible searched at every word, which is what held
    // the Bible screen still, and not a Bible switched to on a guess.
    const others = now.versions
      .map(({ code }) => code)
      .filter((code) => code.toUpperCase() !== (passage.version ?? "").toUpperCase())
      .slice(0, OTHER_BIBLES);
    for (const code of others) {
      void now
        .readChapter(book, chapter, code)
        .then((verses) => {
          if (verses.length > 0) loading.others.push(asScript(verses));
        })
        .catch((): void => undefined);
    }
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
      named = true,
      already = 0,
      inThisBible = false,
    }: {
      sure: boolean;
      step: number;
      version: string | null;
      following?: boolean;
      /** How many of the newest words heard are this passage's own already. */
      already?: number;
      /** Found in the Bible in use, though most Bibles do not have the verse. */
      inThisBible?: boolean;
      /** Said as a reference, which may still be being said; not found by its words. */
      named?: boolean;
    },
  ) => {
    if (s !== state || step < s.takenStep) return;
    const now = input();
    // HARD INVARIANT: a passage the Bible does not have is never shown.
    if (!inThisBible && !passageExists(reference)) {
      // Most Bibles end 3 John at verse 14; the RSV has a fifteenth. Whether
      // the Bible in use has the verse is for that Bible to say.
      const { book, chapter, verseStart, verseEnd } = reference;
      const last = verseEnd ?? verseStart;
      if (book && chapter && chapter >= 1 && chapter <= book.chapters && verseStart && last) {
        const version = s.named ?? now.chosenVersionCode;
        void versesOf(reference, version).then((verses) => {
          const has = (wanted: number) => verses.some(({ verse }) => verse === wanted);
          if (has(verseStart) && has(last)) {
            take(s, reference, { sure, step, version, following, named, already, inThisBible: true });
          } else {
            input().note?.("no such passage", asLookup(reference));
          }
        });
        return;
      }
      now.note?.("no such passage", asLookup(reference));
      return;
    }
    s.takenStep = step;

    // HARD INVARIANT: Active translation is locked to chosenVersionCode
    // unless an explicit version switch command was recognized.
    const activeVersion = s.named ?? now.chosenVersionCode;

    const passage: Passage = {
      reference,
      version: activeVersion,
      key: `${asLookup(reference)}|${activeVersion ?? ""}`,
    };

    s.suggestion = null;
    if (s.current?.key !== passage.key) {
      s.current = passage;
      s.currentAt = Date.now();
      s.currentFrom = s.heardEnd - already;
      loadChapter(s, passage);
      // In FIND IT or SHOW IT, always update the box with the active lookup.
      const lookup = asLookup(reference, activeVersion !== now.chosenVersionCode ? activeVersion : null);
      now.note?.("found", lookup);
      now.fill(lookup);
    }

    // In FIND IT mode: do not project.
    if (now.onHeard !== "show") {
      s.held = null;
      return;
    }

    // A chapter alone is not put on screen; wait for verse.
    if (!sure || reference.verseStart === null) {
      s.held = null;
      return;
    }

    // A reference being named may still be growing ("John 3:16 to 18").
    if (named && !following && !s.ended && (stillSaying(s, reference) || mayStillGrow(s.text, reference))) {
      s.held = { passage, step: s.step };
      return;
    }

    s.held = null;
    project(s, passage, following);
  };

  /**
   * Put a passage in the box and not on screen, for the operator to show or
   * pass over: what the agent is less than sure of. `waiting`: found by its
   * first words, and shown when the rest are said (`bearOutSuggestion`).
   */
  const suggest = (
    s: State,
    reference: ParsedReference,
    waiting: NonNullable<State["suggestion"]> | null = null,
  ) => {
    const now = input();
    const lookup = asLookup(reference);
    // The model suggesting what its first words already did leaves it waiting.
    if (waiting || s.suggested !== lookup) s.suggestion = waiting;
    const open = now.openPassage();
    if (s.suggested === lookup && open.book && asLookup(open) === lookup) return;
    s.suggested = lookup;
    now.note?.("suggested", lookup);
    now.fill(lookup);
  };

  /**
   * The suggestion waiting for the rest of its verse, put up when what was
   * said since its first words bears it out — across a pause, and not word
   * for word (`bearsOutSuggestion`). Let go after `SUGGESTION_WORDS`.
   */
  const bearOutSuggestion = (s: State): boolean => {
    const waiting = s.suggestion;
    if (!waiting) return false;
    const said = s.heardEnd - waiting.from;
    if (said < 0 || said > SUGGESTION_WORDS) {
      s.suggestion = null;
      return false;
    }
    if (!bearsOutSuggestion(rootsOf(lastWords(s.heard, said)), waiting.roots, waiting.rivals)) return false;
    s.suggestion = null;
    s.step += 1;
    const now = input();
    now.note?.("suggestion borne out", asLookup(waiting.reference));
    take(s, waiting.reference, {
      sure: true,
      step: s.step,
      version: s.named ?? now.chosenVersionCode,
      named: false,
      already: said,
    });
    return true;
  };

  /** The newest words heard since the passage in view went up, `most` of them at most. */
  const sinceCurrent = (s: State, most: number): string =>
    lastWords(s.heard, Math.max(0, Math.min(most, s.heardEnd - s.currentFrom)));

  /** The chapter of the passage in view, in every Bible it is loaded in: the one on screen first. */
  const scriptsOf = (s: State): Script[] => {
    const current = s.current;
    const loaded = s.chapter;
    if (!current || !loaded?.verses || loaded.key !== chapterKey(current)) return [];
    return [loaded.verses, ...loaded.others];
  };

  /**
   * The passage in view and the verse after it in `script`, as roots: what a
   * reading that has not left the passage is reading. `null` with no verse
   * in view.
   */
  const passageIn = (s: State, script: Script): { current: string[]; next: string[] } | null => {
    const { verseStart, verseEnd } = s.current?.reference ?? {};
    if (!verseStart) return null;
    const last = verseEnd ?? verseStart;
    return {
      current: script
        .filter(({ verse }) => verse >= verseStart && verse <= last)
        .flatMap(({ roots }) => roots),
      next: script.find(({ verse }) => verse === last + 1)?.roots ?? [],
    };
  };

  /**
   * The Bible the reading is from, as far as its words say: the one whose
   * words for the passage in view (and the verse after it) what was heard
   * since it went up follows furthest. The one on screen, unless another is
   * followed further.
   *
   * John 3:15 read from the King James ends "should not perish, but have
   * eternal life", which the NIV has only in 3:16. Followed in the NIV on
   * screen, the reading was a verse ahead of the reader; followed in the King
   * James it is being read from, it is in 3:15 until 3:15 ends.
   */
  let read = { at: "", script: null as Script | null };
  const scriptRead = (s: State): Script | null => {
    const scripts = scriptsOf(s);
    const shown = scripts[0];
    if (!shown) return null;
    if (scripts.length === 1) return shown;
    // Asked several times at each word heard; worked out once.
    const at = `${s.session}|${s.heardEnd}|${s.currentFrom}|${s.current?.key ?? ""}|${scripts.length}|${s.heard.length}`;
    if (read.at === at && read.script) return read.script;
    const found = scriptReadNow(s, scripts, shown);
    read = { at, script: found };
    return found;
  };
  const scriptReadNow = (s: State, scripts: Script[], shown: Script): Script => {
    const since = rootsOf(sinceCurrent(s, 24));
    if (since.length < 3) return shown;
    let best = shown;
    let bestWords = -1;
    for (const script of scripts) {
      const text = passageIn(s, script) ?? {
        // A chapter open and no verse yet: its opening verses.
        current: script.filter(({ verse }) => verse <= 8).flatMap(({ roots }) => roots),
        next: [],
      };
      const { words } = followed(since, [...text.current, ...text.next]);
      if (words > bestWords) {
        best = script;
        bestWords = words;
      }
    }
    return best;
  };

  const passageText = (s: State): { current: string[]; next: string[] } | null => {
    const script = scriptRead(s);
    return script ? passageIn(s, script) : null;
  };

  /**
   * Whether the passage in view is still being read, or talked through in its
   * own words (`stillIn`) — in any of the Bibles installed. While it is,
   * nothing found by its words alone takes the screen from it.
   */
  const stillReading = (s: State): boolean => {
    // The first words after a verse goes up are its own: it went up because
    // it was named, or because the reading reached it, and "and they will
    // not" tells nothing yet about where it has gone.
    if (s.current?.reference.verseStart && s.heardEnd - s.currentFrom < JUST_UP) return true;
    const tail = rootsOf(lastWords(s.heard, 24));
    const since = rootsOf(sinceCurrent(s, 40));
    // In the Bible it is being read from, and in the one on screen: the
    // others say nothing those two do not, at every word heard.
    const shown = scriptsOf(s)[0];
    const reading = scriptRead(s);
    const scripts = reading && shown && reading !== shown ? [reading, shown] : shown ? [shown] : [];
    return scripts.some((script) => {
      const text = passageIn(s, script);
      if (!text) return false;
      const passage = [...text.current, ...text.next];
      return stillIn(tail, passage) || mostlyIn(since, passage) || followingStill(since, passage);
    });
  };

  /**
   * Read along with the passage in view: the verse being read, as soon as the
   * reading moves on to it (`movedOn`, `goneOnTo`), followed in the Bible it
   * is being read from (`scriptRead`).
   *
   * "moved": on to another verse. "within": still in the passage. "away":
   * the words are not the passage's, and may be looked for elsewhere.
   */
  const follow = (s: State): "moved" | "within" | "away" => {
    const current = s.current;
    const { book, chapter, verseStart, verseEnd } = current?.reference ?? {};
    if (!current || !book || !chapter) return "away";
    const script = scriptRead(s);
    if (!script) return "away";
    const readOn = (verse: number, already: number) => {
      s.step += 1;
      input().note?.("reading on", `${book.name} ${chapter}:${verse}`);
      take(
        s,
        { book, chapter, verseStart: verse, verseEnd: null, versionCode: null, errors: [] },
        { sure: true, step: s.step, version: current.version, following: true, already },
      );
    };
    if (verseEnd === null) {
      const inView = verseStart ?? null;
      const from = inView ?? 1;
      const to = inView === null ? 8 : inView + 3;
      const verses = script.filter(({ verse }) => verse >= from && verse <= to);
      // Only what was heard since the passage went up: the end of the verse
      // before it is not the end of this one, though a psalm's refrain or a
      // genealogy ends them all alike.
      const at = readingAt(readingWords(sinceCurrent(s, 24)), verses, inView);
      const reading = at ? verses.find(({ verse }) => verse === at.verse) : undefined;
      if (at && reading && movedOn(at, inView, reading.words[0])) {
        // Read straight on, the end of the verse on screen just before: moved.
        // Otherwise the words are another verse's on their own, and they are
        // only where the reading is if what was heard since this verse went
        // up follows that verse better than this one. "I will pour out my
        // Spirit", read from another Bible, is word for word in Acts 2:18 —
        // and is Acts 2:17 being read.
        const straightOn = inView !== null && at.verse === inView + 1 && at.matched - at.intoVerse >= 2;
        const inViewRoots = script.find(({ verse }) => verse === inView)?.roots;
        const since = rootsOf(sinceCurrent(s, 16));
        if (
          straightOn
          || !inViewRoots
          || followed(since, reading.roots).words > followed(since, inViewRoots).words
        ) {
          readOn(at.verse, at.intoVerse);
          return "moved";
        }
      }
      // In the box and not on screen — named in passing ("as Paul says in
      // Romans 8:28"), or a number that had to be divided ("Amos 33") — and
      // now being read: it goes up.
      const inViewVerse = script.find(({ verse }) => verse === inView);
      if (
        inView !== null
        && inViewVerse
        && input().onHeard === "show"
        && s.shown?.key !== current.key
        && s.held?.passage.key !== current.key
        && ((at?.verse === inView && at.matched >= 4 && at.telling >= 2)
          || borneOutBy(sinceCurrent(s, 30), inViewVerse.words.join(" ")) === "read")
      ) {
        input().note?.("read aloud", asLookup(current.reference));
        project(s, current);
        return "within";
      }
      // Three words in a row of the passage, up to the newest: being read.
      if (at && at.matched >= 3) return "within";
      if (inView === null) return "away";
      // Read from a Bible that is not installed, or heard badly: not word for
      // word, and on into the next verse all the same.
      const text = passageIn(s, script);
      if (text && text.next.length > 0 && goneOnTo(rootsOf(sinceCurrent(s, 8)), text.current, text.next)) {
        readOn(inView + 1, 0);
        return "moved";
      }
    }
    return stillReading(s) ? "within" : "away";
  };

  /** A chapter's verses in a Bible, kept while they may be asked for again. */
  const chapters = new Map<string, Promise<{ verse: number; text: string }[]>>();
  const versesOf = (reference: ParsedReference, version: string | null) => {
    const { book, chapter } = reference;
    if (!book || !chapter) return Promise.resolve([]);
    const key = `${book.id}|${chapter}|${version ?? ""}`;
    let verses = chapters.get(key);
    if (!verses) {
      verses = input()
        .readChapter(book, chapter, version)
        .catch((): { verse: number; text: string }[] => []);
      chapters.set(key, verses);
      if (chapters.size > 12) chapters.delete(chapters.keys().next().value ?? key);
    }
    return verses;
  };

  /**
   * The passage the box or the screen is on now: what "verse 16" and "next
   * verse" are said within. The agent's own, for a moment after it put it
   * there (the box takes a moment to say so); after that, whatever is in the
   * box, which the operator may have changed.
   */
  const anchor = (s: State): ParsedReference => {
    const open = input().openPassage();
    if (s.current && (!open.book || Date.now() - s.currentAt < 1500)) return s.current.reference;
    // A suggestion the words did not bear out is not somewhere "verse 16" is.
    if (open.book && s.suggested && asLookup(open) === s.suggested) {
      return (
        s.current?.reference
        ?? { book: null, chapter: null, verseStart: null, verseEnd: null, versionCode: null, errors: [] }
      );
    }
    return open;
  };

  /**
   * How what was said bears out a passage the model named, if it does: the
   * reference was said, or the verse's own words were, read or told
   * (`borneOutBy`). A story is weighed against the verse before and after
   * too: the model names the verse nearest the part being told.
   */
  const borneOut = async (
    s: State,
    reference: ParsedReference,
    asked: string,
    { story, version }: { story: boolean; version: string | null },
  ): Promise<"said" | "read" | "told" | null> => {
    if (saysReference(lastWords(s.heard, 60), reference, anchor(s))) return "said";
    const { book, chapter, verseStart, verseEnd } = reference;
    if (!book || !chapter || verseStart === null) return null;
    const verses = await versesOf(reference, version);
    const around = story ? 1 : 0;
    const text = verses
      .filter(({ verse }) => verse >= verseStart - around && verse <= (verseEnd ?? verseStart) + around)
      .map((verse) => verse.text)
      .join(" ");
    const how = text ? borneOutBy(asked, text) : null;
    if (!how) return null;
    // The Bible's own answer first: words that are another verse's, word for
    // word, are that verse, whichever the model named.
    const quoted = await input()
      .findQuotedVerse({
        query: asked,
        versionCode: version,
        versions: "chosen",
        endingWithin: 60,
        ended: true,
      })
      .catch((): null => null);
    if (
      quoted
      && !(
        quoted.bookId === book.id
        && quoted.chapter === chapter
        && quoted.verse >= verseStart - around
        && quoted.verse <= (verseEnd ?? verseStart) + around
      )
    ) {
      return null;
    }
    return how;
  };

  /** Query the LLM only for semantic ambiguity or stories. */
  const ask = (
    s: State,
    { heard, earlier }: { heard: string; earlier: string },
    { open, named, step }: {
      open: ParsedReference;
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
        if (!understood?.reference.book || understood.confidence < 0.5) return;

        // Discard stale or superseded LLM responses.
        if (asked < s.answered) return;
        s.answered = asked;
        if (s !== state || step < s.takenStep) return;

        // Commentary and passing reference mentions must NEVER project automatically!
        if (understood.intent === "COMMENTARY" || understood.intent === "REFERENCE_MENTION") {
          now.note?.("LLM intent", `${understood.intent} - not projecting`);
          if (now.onHeard === "find" && understood.reference.book) {
            now.fill(asLookup(understood.reference));
          }
          return;
        }

        // A story goes on being told: once its passage is in view, keep current.
        if (understood.story) {
          const chapterOf = (reference: ParsedReference | undefined) =>
            reference?.book ? `${reference.book.id} ${reference.chapter}` : null;
          const told = chapterOf(understood.reference);
          if (told === chapterOf(s.current?.reference) || told === chapterOf(open)) return;
        }

        // Echo prevention for open passage.
        const echo =
          asLookup(understood.reference) === asLookup(open)
          && !(
            named?.book?.id === understood.reference.book.id
            && named.chapter === understood.reference.chapter
          );
        if (echo) return;

        const answered = input();
        const same = (passage: Passage | null) =>
          passage !== null && asLookup(passage.reference) === asLookup(understood.reference);
        if (same(s.shown) || (answered.onHeard === "find" && same(s.current))) return;

        // HARD INVARIANT: LLM response NEVER changes translation.
        const version = s.named ?? answered.chosenVersionCode;
        const proposed = understood.reference;
        if (answered.onHeard !== "show") {
          // Find it: a suggestion for the operator to weigh, in the box.
          take(s, proposed, { sure: false, step, version });
          return;
        }
        // HARD INVARIANT: the model proposes; what was said has to bear it out.
        return borneOut(s, proposed, heard, { story: understood.story, version }).then((how) => {
          if (s !== state || step < s.takenStep) return;
          const lookup = asLookup(proposed);
          if (!how) {
            // Nothing said bears it out, however sure the model is: the
            // operator's to weigh. In the box, where Enter shows it; never on
            // the screen.
            answered.note?.("not borne out", lookup);
            if (!stillReading(s)) suggest(s, proposed);
            return;
          }
          // A verse being read is held to, unless another was named outright
          // — or the model has the reading a verse or two further on, and
          // what was said follows that verse better than the one on screen.
          const inView = s.current?.reference;
          const text = passageText(s);
          const ahead = scriptRead(s)?.find(({ verse }) => verse === proposed.verseStart)?.roots;
          const onward =
            inView?.book?.id === proposed.book?.id
            && inView?.chapter === proposed.chapter
            && inView?.verseStart != null
            && proposed.verseStart !== null
            && proposed.verseStart > inView.verseStart
            && proposed.verseStart <= (inView.verseEnd ?? inView.verseStart) + 2
            && text !== null
            && ahead !== undefined
            && followed(rootsOf(heard), ahead).words > followed(rootsOf(heard), text.current).words;
          if (how !== "said" && !onward && stillReading(s)) {
            answered.note?.("held to the passage being read", lookup);
            return;
          }
          answered.note?.(`borne out: ${how}`, lookup);
          take(s, proposed, { sure: understood.mayProject, step, version, named: how === "said" });
        });
      })
      .catch((): void => {
        // Offline or rate-limited; carry on gracefully.
      });
  };

  /**
   * A verse the newest words begin to quote, suggested in the box until the
   * rest of it is said — not while a verse is being read, whose words other
   * verses begin too, and not the passage already up.
   */
  const offer = (
    s: State,
    verse: BibleVerse,
    { fromEnd, rivals }: NonNullable<QuotedVerse["suggested"]>,
    step: number,
  ) => {
    if (step < s.takenStep || stillReading(s)) return;
    const now = input();
    if (s.current && passageHolds(s.current.reference, verse)) return;
    const book = now.books.find((candidate) => candidate.id === verse.bookId);
    if (!book) return;
    const reference: ParsedReference = {
      book,
      chapter: verse.chapter,
      verseStart: verse.verse,
      verseEnd: null,
      versionCode: null,
      errors: [],
    };
    if (s.shown && asLookup(s.shown.reference) === asLookup(reference)) return;
    suggest(s, reference, {
      reference,
      from: Math.max(0, s.heardEnd - fromEnd),
      roots: rootsOf(verse.text),
      rivals: rivals.map((rival) => rootsOf(rival.text)),
    });
    // The rest may have been said while it was looked for.
    bearOutSuggestion(s);
  };

  /**
   * Match spoken text against the verses of the Bible in use, and no other.
   * It changes only when the operator chooses another, or the preacher asks
   * for one ("switch to the NIV"); the next quote is looked for there.
   * Every Bible installed, at every word heard, held the Bible screen still
   * through a live sermon, to find a verse that is shown in this one anyway.
   */
  const quote = (s: State, first: QuoteCheck) => {
    const look = (check: QuoteCheck) => {
      s.quoting = true;
      const now = input();
      void now
        .findQuotedVerse({
          query: check.text,
          versionCode: now.chosenVersionCode,
          versions: "chosen",
          endingWithin: QUOTE_ENDS_WITHIN,
          ended: check.final,
          suggest: true,
        })
        .then((verse) => {
          if (!verse || s !== state || verse.pk === s.quoted) return;

          // HARD INVARIANT: Match score NEVER switches active Bible translation!
          const activeVersion = now.chosenVersionCode;

          const inView = s.current;
          if (verse.suggested) {
            offer(s, verse, verse.suggested, check.step);
            return;
          }
          if (inView && passageHolds(inView.reference, verse)) {
            s.quoted = verse.pk;
            if (inView.version !== activeVersion) {
              take(s, inView.reference, { sure: true, step: check.step, version: activeVersion });
            }
            return;
          }
          const book = now.books.find((candidate) => candidate.id === verse.bookId);
          if (!book) return;
          // HARD INVARIANT: a verse being read is held to. Its words are in
          // other verses too — Matthew 22:37 is Deuteronomy 6:5 quoted — and
          // the reading is not over because another verse has them.
          if (stillReading(s)) {
            now.note?.("held to the passage being read", `${book.name} ${verse.chapter}:${verse.verse}`);
            return;
          }
          s.quoted = verse.pk;
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
            // Found by its words, not said as a reference still being said:
            // waiting for "the next word" let a later number word drop it.
            { sure: true, step: check.step, version: activeVersion, named: false },
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

    if (s.quoting) {
      s.nextQuote = first;
      return;
    }
    look(first);
  };

  /** An explicitly requested Bible download has finished. */
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

  /**
   * Main speech ingestion entrypoint.
   * Handles string transcripts or rich AssemblyAI TranscriptEvents.
   */
  const hear = (inputParam: string | TranscriptEvent, isFinal = false) => {
    const now = input();
    if (!now.enabled) return;

    let event: TranscriptEvent;
    if (typeof inputParam === "string") {
      const text = inputParam.trim();
      if (!text) return;
      const s = state;
      if (s.ended && !text.startsWith(s.text)) {
        s.turn += 1;
        s.askedWords = 0;
      }
      event = {
        session: s.session,
        turn: s.turn,
        transcript: text,
        endOfTurn: isFinal,
        receivedAt: Date.now(),
      };
    } else {
      event = inputParam;
    }

    const s = state;
    const text = event.transcript.trim();
    if (!text) return;

    // A new connection to the speech service (the last one's time was up, or
    // it dropped, and listening carried on): its turns and its words are
    // counted from nothing again. What is on screen stays as it is; where
    // its reading had got to starts from here.
    if (typeof inputParam !== "string" && event.session !== s.session) {
      s.session = event.session;
      s.turn = -1;
      s.text = "";
      s.ended = false;
      s.cueKey = "";
      s.askedWords = 0;
      s.steppedTurn = -1;
      s.steppedWords = 0;
      s.held = null;
      s.heardEnd = 0;
      s.currentFrom = 0;
      s.suggestion = null;
    }

    // Ingest into persistent transcript buffer.
    const update = buffer.ingest(event);
    if (update.ignored) {
      now.note?.("buffer ignored", update.ignored);
      return;
    }

    s.turn = event.turn;
    s.text = text;
    s.ended = event.endOfTurn;
    const newest = event.words?.at(-1);
    s.growing = !event.endOfTurn && newest?.final === false && /\d/.test(newest.text);

    // Rolling transcript text spanning across turn boundaries and pauses.
    s.heardEnd = update.stableEnd + update.tentative.length;
    const stableWords = buffer.recent(HEARD_WORDS);
    const rollingText = textOf(stableWords) + (update.tentative.length > 0 ? ` ${textOf(update.tentative)}` : "");
    const heard = lastWords(rollingText, HEARD_WORDS);
    s.heard = heard;

    // 1. DETERMINISTIC COMMAND PRECEDENCE:
    // "Next verse", "previous verse": acted on once each time it is said. The
    // turn is heard again as every word is added to it, so the words a step
    // took up are left out from then on (`findStepCommand`).
    if (s.steppedTurn !== event.turn) {
      s.steppedTurn = event.turn;
      s.steppedWords = 0;
    }
    const unstepped = text.split(/\s+/).slice(s.steppedWords).join(" ");
    const stepCommand = now.commands === false ? null : findStepCommand(unstepped);
    if (stepCommand) {
      s.steppedWords += stepCommand.words;
      const direction = stepCommand.type === "next_verse" ? "next" : "previous";
      const active = anchor(s);
      now.note?.("step", direction);
      if (active.book && active.chapter && active.verseStart !== null) {
        const stepResult = stepPassage(
          {
            book: { name: active.book.name, chapters: active.book.chapters },
            chapter: active.chapter,
            verseStart: active.verseStart,
            verseEnd: active.verseEnd,
            versionCode: now.chosenVersionCode,
          },
          direction,
          () => s.chapter?.verses?.length ?? 50,
        );
        if (stepResult) {
          s.step += 1;
          take(
            s,
            {
              book: active.book,
              chapter: stepResult.chapter,
              verseStart: stepResult.verseStart,
              verseEnd: stepResult.verseEnd,
              versionCode: null,
              errors: [],
            },
            { sure: true, step: s.step, version: now.chosenVersionCode, named: false },
          );
        }
      } else {
        // A whole chapter in the box: the verse on screen is the host's to know.
        now.step?.(direction);
      }
      return;
    }

    // Other explicit commands ("turn to Romans 8:28", "show verse 12", "switch to NIV").
    const explicit = parseExplicitCommand(text, {
      books: now.books,
      versions: [...now.versions, ...now.catalog],
      activePassage: anchor(s),
    });
    // A step was acted on when it was said, above.
    const command =
      explicit?.type === "next_verse" || explicit?.type === "previous_verse" ? null : explicit;

    if (command) {
      if (command.type === "switch_version") {
        const isInstalled = now.versions.some((v) => v.code === command.versionCode);
        s.named = command.versionCode;
        now.note?.("Version switch command", command.versionCode);
        if (isInstalled) {
          now.chooseVersion(command.versionCode);
          // If a passage was already shown or in view, project it in the new version
          const inView = s.current;
          if (inView && inView.reference?.book) {
            s.step += 1;
            take(s, inView.reference, {
              sure: s.shown !== null,
              step: s.step,
              version: command.versionCode,
            });
          }
        } else {
          // Trigger download if in catalog
          s.awaiting = command.versionCode;
          void now.install(command.versionCode).then((ok) => {
            if (ok && s === state) arrived(s, command.versionCode);
          });
        }
        // If the utterance contains no book reference cues, version switch was the only action.
        const cues = cuesOf(text, bookWordsFor(now.books));
        if (!cues.worthAsking) {
          return;
        }
      }

      if (command.type === "navigate_verse") {
        const active = anchor(s);
        if (active.book && active.chapter) {
          s.step += 1;
          const newRef: ParsedReference = {
            book: active.book,
            chapter: active.chapter,
            verseStart: command.verse,
            verseEnd: null,
            versionCode: null,
            errors: [],
          };
          take(s, newRef, { sure: true, step: s.step, version: now.chosenVersionCode });
          return;
        }
      }

      if (command.type === "navigate_passage") {
        s.step += 1;
        take(s, command.reference, { sure: true, step: s.step, version: now.chosenVersionCode });
        return;
      }
    }

    // 2. PARSE EXPLICIT REFERENCE:
    const cues = cuesOf(text, bookWordsFor(now.books));
    const cueKey = `${s.turn}|${cues.key}|${s.named ?? ""}`;
    const turnWords = text.split(/\s+/);
    const words = turnWords.length;

    const newWords = () => {
      const from = Math.max(0, Math.min(s.askedWords, words - STORY_EVERY_WORDS));
      return {
        heard: turnWords.slice(from).join(" "),
        earlier: lastWords(textOf(buffer.recent(EARLIER_WORDS)), EARLIER_WORDS),
      };
    };

    let read = false;
    let reading: ReturnType<typeof readNewestReference> = null;

    if (cueKey !== s.cueKey) {
      s.cueKey = cueKey;
      s.step += 1;
      s.held = null;

      const open = anchor(s);
      reading = readNewestReference(text, now.books, open, lastWords(textOf(buffer.recent(20)), 20));
      // A verse said with no book is acted on a word later, or when the turn
      // ends: "verse one" is the passage's — until "of the song" follows it.
      // Read again at the next word, whatever that word is.
      if (
        reading?.within
        && !event.endOfTurn
        && (newest?.final === false || /^(?:\d|verses?|chapters?|of|the|to|and|through|from)\b/i.test(turnWords.at(-1) ?? ""))
      ) {
        s.cueKey = "";
        reading = null;
      }
      if (reading) {
        take(s, reading.reference, {
          sure: reading.plain,
          step: s.step,
          version: s.named ?? input().chosenVersionCode,
          // What follows the reference in this turn is its reading, begun.
          already: wordsAfterLastCue(text, bookWordsFor(now.books)),
        });
      }
      read = Boolean(reading?.plain);
      if (read) {
        s.askedWords = words;
      } else if (cues.worthAsking) {
        ask(s, newWords(), { open, named: reading?.reference ?? null, step: s.step });
        s.askedWords = words;
      }
    }

    // 3. STORY OR PARAPHRASE DETECTION VIA LLM:
    const unasked = words - s.askedWords;
    if (!read && (unasked >= STORY_EVERY_WORDS || (event.endOfTurn && unasked >= STORY_LEAST_WORDS))) {
      ask(s, newWords(), { open: anchor(s), named: null, step: s.step });
      s.askedWords = words;
    }

    // 4. HELD PASSAGE RELEASE:
    const held = s.held;
    if (
      held &&
      (event.endOfTurn ||
        (!stillSaying(s, held.passage.reference) && !mayStillGrow(text, held.passage.reference)))
    ) {
      s.held = null;
      project(s, held.passage);
    }

    // 5. A SUGGESTION'S VERSE, FINISHED: its first words suggested it, and
    // the rest has been said since — after a pause, or not word for word.
    bearOutSuggestion(s);

    // 6. SEQUENTIAL READING & ROLLING QUOTE MATCHING:
    // First try reading along with the passage in view. Only once the words
    // have left it is quoted scripture looked for in the rest of the Bible.
    if (follow(s) === "away") {
      // Only what was heard since the passage in view went up: the words
      // before it named it, or were the verse read before it, and found
      // again they took the screen back to the verse just left.
      const from = s.current ? s.currentFrom : 0;
      const quoteText = textOf(
        [...buffer.recent(QUOTE_WORDS), ...update.tentative]
          .filter(({ pos }) => pos >= from)
          .slice(-QUOTE_WORDS),
      );
      if (quoteText.split(/\s+/).filter(Boolean).length >= 2) {
        quote(s, {
          text: quoteText,
          final: event.endOfTurn,
          version: now.chosenVersionCode,
          step: s.step,
        });
      }
    }
  };

  return {
    hear,
    forget: () => {
      state = fresh();
      buffer.reset(0);
    },
    update: (next) => {
      current = next;
      const s = state;
      const code = s.awaiting;
      if (code && next.versions.some((version) => version.code === code)) {
        setTimeout(() => arrived(s, code), 0);
      }
    },
  };
}
