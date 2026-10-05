/**
 * Reading what a preacher is saying, as it is said, without a model.
 *
 * AssemblyAI sends the words of a turn again and again as they grow — every
 * short pause with Universal-3.5 Pro, already written as "Romans 8:28" — and
 * the Bible tab reads each one (`hooks/useHeardScripture.ts`). This is the
 * part that needs no network: the newest passage the words name, the Bible
 * they name, whether the reference may still be being said, and whether
 * there is anything in them worth asking the model about.
 */

import { type BibleBookRecord } from "./db";
import { findRelativeReference, parseReference, type ParsedReference } from "./parser";

/** A Bible as the tab lists it: "KJV", "King James Version". */
export type NamedVersion = { code: string; name: string };

/** A reference as the Bible tab's box reads one: "John 3:16-18 NIV". */
export function asLookup(
  { book, chapter, verseStart, verseEnd }: ParsedReference,
  versionCode: string | null = null,
): string {
  let spoken = `${book?.name ?? ""} ${chapter ?? 1}`;
  if (verseStart) {
    spoken += `:${verseStart}`;
    if (verseEnd) {
      spoken += `-${verseEnd}`;
    }
  }
  if (versionCode) {
    spoken += ` ${versionCode}`;
  }
  return spoken;
}

/** The newest `limit` words of `text`. */
export function lastWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(Math.max(0, words.length - limit)).join(" ");
}

/** Sentences, oldest first, split where the transcriber ended one. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?;]+(?=\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The newest reference a sentence names, rather than the first: "we read
 * John 3:16, now turn to Romans 5 verse 8" is Romans 5:8. "1 John 1:9" is
 * read as one reference, not as "1 John 1:9" and then "John 1:9" after it.
 */
function newestReferenceIn(
  sentence: string,
  books: BibleBookRecord[],
): ParsedReference | null {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  // The parser reads the first book anywhere in what it is given, so the
  // words are given to it from the end, a word more each time.
  const read = (start: number) => {
    const parsed = parseReference(words.slice(start).join(" "), books);
    return parsed.book && parsed.chapter && parsed.errors.length === 0 ? parsed : null;
  };
  for (let start = words.length - 1; start >= 0; start -= 1) {
    let newest = read(start);
    if (!newest) continue;
    // "1 John", "Song of Solomon": the name may begin a word or two before
    // the part of it found first.
    for (let earlier = start - 1; earlier >= Math.max(0, start - 3); earlier -= 1) {
      const longer = read(earlier);
      if (longer && longer.book?.id !== newest.book?.id) newest = longer;
    }
    return { ...newest, versionCode: null };
  }
  return null;
}

/**
 * The lower-case words of each book's name: "song", "solomon", "john" — and
 * each with an "s" or without one, as the parser reads them, since "Psalm 23"
 * is how the book called Psalms is said.
 */
export function bookWordsOf(books: BibleBookRecord[]): Set<string> {
  const words = new Set<string>();
  for (const book of books) {
    for (const word of book.name.toLowerCase().split(/[^\p{L}]+/u)) {
      if (word.length < 3 || word === "the") continue;
      words.add(word);
      words.add(word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : `${word}s`);
    }
  }
  return words;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export type Reading = {
  reference: ParsedReference;
  /**
   * Said so that it cannot be anything else: a chapter and verse written
   * "8:28", or "chapter … verse …" said in so many words, or a verse said
   * within the passage just named. Plain readings go on screen without the
   * model; "Mark 2 people" is a reading too, and is not.
   */
  plain: boolean;
};

const PLACE_WORD = /^(chapters?|verses?|cap[ií]tulos?|vers[ií]culos?|chapitres?|versets?|kapitel|verse?n?)$/u;

/**
 * The newest passage the words name, read without a model.
 *
 * Sentences are read newest first. A verse or chapter said on its own ("and
 * then look at verse 16") is read within the passage named earlier in the
 * same words, else within `open`, the one in the Bible tab — but not when
 * the words name a different book, without a chapter, since "turn to
 * Habakkuk. Chapter 3, verse 16" is not in the passage left open. That is
 * left to the model, which hears it all.
 *
 * `earlier`: the turn before, for the passage a verse is said within and
 * nothing else. What it named was read when it was said; read again now, a
 * "verse 16" in it would be read within whatever the operator has opened
 * since.
 */
export function readNewestReference(
  text: string,
  books: BibleBookRecord[],
  open: ParsedReference,
  earlier = "",
): Reading | null {
  const before = sentencesOf(earlier);
  const sentences = [...before, ...sentencesOf(text)];
  for (let index = sentences.length - 1; index >= before.length; index -= 1) {
    const sentence = sentences[index] ?? "";
    const named = newestReferenceIn(sentence, books);
    if (named) {
      const plain =
        named.verseStart !== null
        && (/\d+\s*:\s*\d+/.test(sentence)
          || (/\bchapters?\b/i.test(sentence) && /\bverses?\b/i.test(sentence)));
      return { reference: named, plain };
    }
    if (!/\b(verses?|chapters?)\b/i.test(sentence)) {
      continue;
    }
    let base: ParsedReference = open;
    let since = 0;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const named = newestReferenceIn(sentences[previous] ?? "", books);
      if (named) {
        base = named;
        since = previous + 1;
        break;
      }
    }
    if (!base.book) return null;
    const ownWords = bookWordsOf([base.book]);
    const everyBookWord = bookWordsOf(books);
    const otherBook = wordsOf(sentences.slice(since, index + 1).join(" ")).some(
      (word) => everyBookWord.has(word) && !ownWords.has(word),
    );
    if (otherBook) return null;
    const relative = findRelativeReference(sentence, base);
    return relative ? { reference: relative, plain: true } : null;
  }
  return null;
}

const NUMBER_WORDS = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety", "hundred",
]);
const TENS = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)$/;
const ORDINAL = /^(\d+(st|nd|rd|th)|first|second|third|\p{L}+th)$/u;
/** Words after which a reference is not finished: "John 3 verse", "16 to". */
const UNFINISHED_AFTER = new Set([
  "and", "to", "through", "thru", "of", "the", "in", "at", "from", "book",
  "first", "second", "third", "1st", "2nd", "3rd", "gospel", "according",
]);

function isNumber(word: string): boolean {
  return /^\d+(:\d+)?(-\d+)?$/.test(word) || NUMBER_WORDS.has(word);
}

/**
 * Whether the reference may still be being said: the words end where more of
 * it would come. "John chapter 3" may yet be "John chapter 3 verse 16";
 * "verse twenty" may be "verse twenty-eight"; "Romans 8:28 in the" may be
 * "in the NIV". A passage that is sure goes on screen once the next words
 * show it was finished, or the turn ends — half a second of quiet.
 *
 * "John, chapter 10." was one of Universal-3.5 Pro's guesses on the way to
 * "John chapter 3 and the 3rd verse", which is why a chapter on its own
 * waits even when the transcriber put a full stop after it.
 */
export function mayStillGrow(text: string, reference: ParsedReference): boolean {
  const words = wordsOf(text);
  const last = words.at(-1);
  if (!last) return false;
  if (TENS.test(last)) return true;
  if (PLACE_WORD.test(last)) return !ORDINAL.test(words.at(-2) ?? "");
  if (UNFINISHED_AFTER.has(last)) return true;
  return reference.verseStart === null && isNumber(last);
}

/**
 * What in the words could name a passage, in order, and whether it is worth
 * asking the model about: a chapter or verse said, a chapter and verse
 * written "2:3", or a book's name with a number. The model is asked again
 * only when this changes — the words that follow a reference, the verse
 * being read, change nothing it would answer.
 */
export function cuesOf(
  text: string,
  bookWords: Set<string>,
): { key: string; worthAsking: boolean } {
  const cues = wordsOf(text).filter(
    (word) => /\d/.test(word) || NUMBER_WORDS.has(word) || PLACE_WORD.test(word) || bookWords.has(word),
  );
  const worthAsking =
    cues.some((word) => PLACE_WORD.test(word) || /^\d+:\d+/.test(word))
    || (cues.some((word) => bookWords.has(word)) && cues.some(isNumber));
  return { key: cues.join(" "), worthAsking };
}

/** Version codes that are also words a preacher says: "the net", "an amp". */
const CODES_THAT_ARE_WORDS = new Set([
  "AMP", "NET", "WEB", "VOICE", "MESSAGE", "LIVING", "GOOD", "NEWS", "LIFE", "WAY",
  "ERV", "EXB", "GW", "NOG", "OJB",
]);
const SAID_AS_A_BIBLE = String.raw`\s+(?:version|bible|translation)\b`;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bounded(pattern: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, `g${flags}u`);
}

/** Every way a Bible is said, as patterns over the transcript. */
function patternsFor({ code, name }: NamedVersion): RegExp[] {
  const patterns: RegExp[] = [];
  const upper = code.trim().toUpperCase();
  if (upper) {
    const escaped = escapeRegex(upper);
    // "KJV" as the transcriber writes it; "kjv" too, unless it is a word.
    patterns.push(bounded(escaped, ""));
    patterns.push(
      CODES_THAT_ARE_WORDS.has(upper)
        ? bounded(`${escaped}${SAID_AS_A_BIBLE}`, "i")
        : bounded(escaped, "i"),
    );
    // "K J V", "k.j.v."
    if (/^[A-Z]{2,5}$/.test(upper)) {
      patterns.push(bounded(upper.split("").join(String.raw`[\s.]+`) + "\\.?", "i"));
    }
  }
  const core = name
    .replace(/\(.*?\)/g, " ")
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/\s+(version|bible|translation)$/i, "")
    .trim();
  if (core) {
    const flexible = core
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(escapeRegex)
      .join(String.raw`[\s-]+`);
    // "King James", "New International" are a Bible however they end;
    // "Amplified" and "Message" only when said as one.
    patterns.push(
      bounded(
        core.split(/[\s-]+/).filter(Boolean).length >= 2
          ? flexible
          : `${flexible}${SAID_AS_A_BIBLE}`,
        "i",
      ),
    );
  }
  return patterns;
}

/**
 * What the common Bibles are called aloud, by code, said in full.
 *
 * The catalog installs a Bible under its code alone — "KJV" is both its code
 * and its name — so "the King James" or "the New International Version" was
 * never recognised by the name it was installed under. Each is matched as
 * written here, whole: "Good News" alone is the gospel, not the GNT, and
 * "God's word" is not a translation until it is said to be one. A name and
 * the same name with "Version" after it are both listed, so that the longer
 * of two names ending together still wins ("New King James Version").
 */
const SAID_IN_FULL: Record<string, string[]> = {
  KJV: ["King James", "King James Version", "King James Bible", "Authorized Version"],
  NKJV: ["New King James", "New King James Version", "New King James Bible"],
  NIV: ["New International", "New International Version"],
  NIRV: ["New International Reader's Version", "New International Readers Version"],
  ESV: ["English Standard", "English Standard Version"],
  NLT: ["New Living Translation"],
  AMP: ["Amplified Bible", "Amplified Version", "Amplified Translation"],
  AMPC: ["Amplified Classic", "Classic Amplified", "Amplified Bible Classic"],
  MSG: ["The Message Bible", "The Message Translation", "The Message Version"],
  TPT: ["Passion Translation", "The Passion Translation"],
  RSV: ["Revised Standard", "Revised Standard Version"],
  NRSV: ["New Revised Standard", "New Revised Standard Version"],
  GNT: ["Good News Translation", "Good News Bible"],
  ERV: ["Easy-to-Read Version", "Easy to Read Version"],
  NASB: ["New American Standard", "New American Standard Bible"],
  CSB: ["Christian Standard Bible"],
  HCSB: ["Holman Christian Standard Bible"],
  NET: ["New English Translation"],
  WEB: ["World English Bible"],
  ASV: ["American Standard Version"],
  CEV: ["Contemporary English Version"],
  NCV: ["New Century Version"],
  TLB: ["The Living Bible"],
  YLT: ["Young's Literal Translation"],
  GW: ["God's Word Translation"],
  MEV: ["Modern English Version"],
};

/**
 * The installed Bibles as they are said, for the voice service to listen
 * for: each code, and the first of its full names ("KJV", "King James").
 */
export function versionKeyterms(versions: NamedVersion[]): string[] {
  return versions.flatMap(({ code }) => {
    const upper = code.trim().toUpperCase();
    const said = SAID_IN_FULL[upper]?.[0];
    return said ? [upper, said] : [upper];
  });
}

/** The installed Bible's full names, when the catalog has given it only a code. */
function saidInFull({ code }: NamedVersion): RegExp[] {
  return (SAID_IN_FULL[code.trim().toUpperCase()] ?? []).map((phrase) =>
    bounded(
      phrase
        .split(/[\s-]+/)
        .map(escapeRegex)
        .join(String.raw`[\s-]+`),
      "i",
    ),
  );
}

/**
 * The installed Bible the words name last, or `null`: "in the New
 * International Version", "the KJV says", "K J V". Of two names ending in
 * the same place the longer wins, so "New King James Version" is the NKJV and
 * not the King James inside it.
 */
export function findNamedVersion(text: string, versions: NamedVersion[]): string | null {
  let best: { code: string; end: number; length: number } | null = null;
  for (const version of versions) {
    for (const pattern of [...patternsFor(version), ...saidInFull(version)]) {
      for (const match of text.matchAll(pattern)) {
        const end = (match.index ?? 0) + match[0].length;
        if (
          !best
          || end > best.end
          || (end === best.end && match[0].length > best.length)
        ) {
          best = { code: version.code, end, length: match[0].length };
        }
      }
    }
  }
  return best?.code ?? null;
}

/** Whether `verse` is in the passage `reference` names. */
export function passageHolds(
  reference: ParsedReference,
  verse: { bookId: string; chapter: number; verse: number },
): boolean {
  if (reference.book?.id !== verse.bookId || reference.chapter !== verse.chapter) {
    return false;
  }
  if (reference.verseStart === null) return true;
  const end = reference.verseEnd ?? reference.verseStart;
  return verse.verse >= reference.verseStart && verse.verse <= end;
}

/** The words of a verse, or of what was heard, as reading along compares them. */
export function readingWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Where the newest words are, in verses being read aloud. */
export type ReadingAt = {
  /** The verse the newest word is in. */
  verse: number;
  /** How many of the newest words follow the text, up to there. */
  matched: number;
  /** How many of those are that verse's own; the rest end the verse before. */
  intoVerse: number;
};

/**
 * Where the newest words are being read from, in these verses taken in order:
 * the verse they end in, and how far back they follow the text. Of two
 * places they follow as far, the verse `stay` — the one on screen — is kept.
 */
export function readingAt(
  heard: string[],
  verses: { verse: number; words: string[] }[],
  stay: number | null,
): ReadingAt | null {
  const text = verses.flatMap(({ verse, words }) =>
    words.map((word, at) => ({ word, verse, at })),
  );
  let best: ReadingAt | null = null;
  for (let end = 0; end < text.length; end += 1) {
    let matched = 0;
    while (
      matched < heard.length
      && matched <= end
      && heard[heard.length - 1 - matched] === text[end - matched]?.word
    ) {
      matched += 1;
    }
    if (matched === 0) continue;
    const place = text[end];
    if (!place) continue;
    const found = { verse: place.verse, matched, intoVerse: Math.min(matched, place.at + 1) };
    if (!best || matched > best.matched || (matched === best.matched && found.verse === stay)) {
      best = found;
    }
  }
  return best;
}

/** Words a verse often begins with, too common to move on by one alone. */
const COMMON_OPENINGS = new Set([
  "and", "the", "a", "an", "of", "to", "in", "for", "but", "he", "she", "it",
  "they", "i", "you", "we", "that", "this", "then", "so", "as", "at", "by",
  "with", "on", "is", "was", "be", "his", "her", "their", "my", "your", "our",
  "who", "which", "said", "unto", "now", "when", "there", "if", "not", "all",
]);

/**
 * Whether reading has moved on to `at.verse`, from `inView` (`null`: a
 * chapter, no verse yet).
 *
 * Read straight on from the verse on screen, two words of the next do it —
 * "…over the face of the waters. And God" is Genesis 1:3 — or one that is not
 * a common opening ("…shall not perish. Jesus"); the end of the verse before
 * must have been read just before them, two words of it at least. Started
 * after a pause, or with a chapter open and no verse, three words of a verse
 * in a row do it.
 */
export function movedOn(
  at: ReadingAt,
  inView: number | null,
  firstWord: string | undefined,
): boolean {
  if (at.verse === inView) return false;
  if (inView !== null && at.verse < inView) return false;
  const before = at.matched - at.intoVerse;
  if (before >= 2) {
    return at.intoVerse >= 2 || (at.intoVerse === 1 && !COMMON_OPENINGS.has(firstWord ?? ""));
  }
  return at.intoVerse >= 3;
}
