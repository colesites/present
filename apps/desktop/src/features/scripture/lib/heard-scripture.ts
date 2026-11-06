/**
 * The Real-Time Bible Agent: what the preacher says, read and acted on in real-time.
 *
 * Architecture & Core Invariants:
 * 1. TWO OPERATIONAL MODES:
 *    - SHOW IT: Automatically projects scripture to the church screen when verified criteria
 *      are satisfied (verified explicit navigation commands, high-confidence sequential reading,
 *      or high-confidence SCRIPTURE_READING intent).
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
 * 5. LLM FOR SEMANTIC AMBIGUITY ONLY:
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
  type NamedVersion,
} from "./listening";
import { verseCouldGrow, type ParsedReference } from "./parser";
import {
  createTranscriptBuffer,
  DEFAULT_RETENTION,
  textOf,
  type TranscriptEvent,
} from "./transcript-buffer";
import { parseExplicitCommand } from "./command-parser";
import { stepPassage } from "./step-reference.mjs";

export type SpeechIntent =
  | "SCRIPTURE_READING"
  | "COMMENTARY"
  | "REFERENCE_MENTION"
  | "NAVIGATION_REQUEST"
  | "UNCERTAIN";

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
        intent?: SpeechIntent;
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
  chapter: null as { key: string; verses: { verse: number; words: string[] }[] | null } | null,
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
        // Reading may have progressed while chapter was loading.
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

    // HARD INVARIANT: Active translation is locked to chosenVersionCode
    // unless an explicit version switch command was recognized.
    const activeVersion = s.named ?? now.chosenVersionCode;

    const passage: Passage = {
      reference,
      version: activeVersion,
      key: `${asLookup(reference)}|${activeVersion ?? ""}`,
    };

    if (s.current?.key !== passage.key) {
      s.current = passage;
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
    if (!following && !s.ended && (stillSaying(s, reference) || mayStillGrow(s.text, reference))) {
      s.held = { passage, step: s.step };
      return;
    }

    s.held = null;
    project(s, passage, following);
  };

  /**
   * Read along with the passage in view: the verse being read, as soon as the
   * reading moves on to it (`movedOn`).
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

    // Reading moved on to the next verse.
    s.step += 1;
    input().note?.("reading on", `${book.name} ${chapter}:${at.verse}`);
    take(
      s,
      { book, chapter, verseStart: at.verse, verseEnd: null, versionCode: null, errors: [] },
      { sure: true, step: s.step, version: current.version, following: true },
    );
    return true;
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
        take(s, understood.reference, { sure: understood.mayProject, step, version });
      })
      .catch((): void => {
        // Offline or rate-limited; carry on gracefully.
      });
  };

  /** Match spoken text against Bible verses. */
  const quote = (s: State, first: QuoteCheck) => {
    const look = (check: QuoteCheck) => {
      s.quoting = true;
      const now = input();
      void now
        .findQuotedVerse({
          query: check.text,
          versionCode: now.chosenVersionCode,
          versions: check.final ? "all" : "indexed",
          endingWithin: QUOTE_ENDS_WITHIN,
        })
        .then((verse) => {
          if (!verse || s !== state || verse.pk === s.quoted) return;
          s.quoted = verse.pk;

          // HARD INVARIANT: Match score NEVER switches active Bible translation!
          const activeVersion = now.chosenVersionCode;

          const inView = s.current;
          if (inView && passageHolds(inView.reference, verse)) {
            if (inView.version !== activeVersion) {
              take(s, inView.reference, { sure: true, step: check.step, version: activeVersion });
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
            { sure: true, step: check.step, version: activeVersion },
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
    const stableWords = buffer.recent(HEARD_WORDS);
    const rollingText = textOf(stableWords) + (update.tentative.length > 0 ? ` ${textOf(update.tentative)}` : "");
    const heard = lastWords(rollingText, HEARD_WORDS);
    s.heard = heard;

    // 1. DETERMINISTIC COMMAND PRECEDENCE:
    // Check for explicit commands ("next verse", "turn to Romans 8:28", "switch to NIV").
    const command = parseExplicitCommand(text, {
      books: now.books,
      versions: [...now.versions, ...now.catalog],
      activePassage: s.current?.reference ?? now.openPassage(),
    });

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

      if (command.type === "next_verse" || command.type === "previous_verse") {
        const active = s.current?.reference ?? now.openPassage();
        if (active.book && active.chapter) {
          const stepResult = stepPassage(
            {
              book: { name: active.book.name, chapters: active.book.chapters },
              chapter: active.chapter,
              verseStart: active.verseStart,
              verseEnd: active.verseEnd,
              versionCode: now.chosenVersionCode,
            },
            command.type === "next_verse" ? "next" : "previous",
            () => s.chapter?.verses?.length ?? 50,
          );
          if (stepResult) {
            s.step += 1;
            const newRef: ParsedReference = {
              book: active.book,
              chapter: stepResult.chapter,
              verseStart: stepResult.verseStart,
              verseEnd: stepResult.verseEnd,
              versionCode: null,
              errors: [],
            };
            take(s, newRef, { sure: true, step: s.step, version: now.chosenVersionCode });
            return;
          }
        }
      }

      if (command.type === "navigate_verse") {
        const active = s.current?.reference ?? now.openPassage();
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

      const open = now.openPassage();
      reading = readNewestReference(text, now.books, open, lastWords(textOf(buffer.recent(20)), 20));
      if (reading) {
        take(s, reading.reference, {
          sure: reading.plain,
          step: s.step,
          version: s.named ?? input().chosenVersionCode,
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
      ask(s, newWords(), { open: now.openPassage(), named: null, step: s.step });
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

    // 5. SEQUENTIAL READING & ROLLING QUOTE MATCHING:
    // First try reading along with the chapter in view.
    // If not reading along, search for quoted scripture across the rolling buffer!
    if (!follow(s, heard)) {
      const quoteText = lastWords(textOf(buffer.recent(QUOTE_WORDS)), QUOTE_WORDS);
      quote(s, {
        text: quoteText.length > 5 ? quoteText : text,
        final: event.endOfTurn,
        version: now.chosenVersionCode,
        step: s.step,
      });
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
