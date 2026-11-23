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
import {
  findBookNamed,
  findRelativeReference,
  numbersSaid,
  parseReference,
  type ParsedReference,
} from "./parser";

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
   * Said so that it cannot be anything else: a book, its chapter and a
   * verse — "Romans 8:28", "Psalm 23 verse 1", "Genesis 3 16", "chapter …
   * verse …" in so many words — or a verse said within the passage just
   * named. Plain readings go on screen without the model. A chapter alone
   * ("Mark 2 people") is a reading too, and is not; nor is a reference in a
   * sentence about it ("as Paul says in Romans 8:28").
   */
  plain: boolean;
  /**
   * A verse or chapter said with no book, read within a passage named before
   * or open. What follows it can make it something else ("verse one of the
   * song"), so it is acted on a word later (`heard-scripture.ts`).
   */
  within?: boolean;
};

/**
 * Words that make a "verse" a hymn's and not the Bible's: "let us sing hymn
 * 23, verse 1 and verse 4" is not Psalm 23, and "we sing verse 2" is not the
 * second verse of the passage on screen.
 */
const SUNG_WORDS = /\b(?:hymns?|hymnal|songs?|sing|sings|singing|sang|chorus|stanzas?|refrain)\b/i;
const sung = (sentence: string): boolean =>
  SUNG_WORDS.test(sentence.replace(/\bsongs?\s+of\s+(?:solomon|songs)\b/gi, " "));

/**
 * A chapter or verse of something that is not the Bible: "chapter 2 of my
 * life", "the first chapter of his career", "verse 3 of the hymn".
 */
const OF_SOMETHING_ELSE =
  /\b(?:verses?|chapters?)\s+(?:[\p{L}\p{N}-]+\s+){0,3}?of\s+(?:my|your|his|her|our|their|this|that|a|an|the\s+(?!books?\b|gospel\b|epistle\b|letter\b|psalms?\b|bible\b|chapter\b))/iu;

/** What is said on the way to a book: "the book of …", "turn to …", "reading from …". */
const TOWARDS_A_BOOK =
  /\b(?:books?|gospel|epistle|letter)\s+(?:of|to|according)\b|\b(?:turn|open|go|going|read|reading|look|looking)\b[^.]*\b(?:to|from|at|in|into)\b/i;

/**
 * A book named on its own, with its chapter and verse still to come: "I want
 * us to read from the book of Ephesians." … "Chapter 5." … "Verse 28." Only
 * when it is said as a book — after "the book of", "turn to", or as all there
 * is to the sentence ("First Corinthians.") — since John, Mark, Ruth and
 * James are people in the congregation too.
 */
function bookNamedAlone(sentence: string, books: BibleBookRecord[]): BibleBookRecord | null {
  if (sung(sentence)) return null;
  const book = findBookNamed(sentence, books);
  if (!book) return null;
  return wordsOf(sentence).length <= 3 || TOWARDS_A_BOOK.test(sentence) ? book : null;
}

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
      // "The gospel according to Saint Matthew" is the book's name, not a
      // sentence about it.
      const isMentionFraming =
        /\b(?:as\s+(?:\w+\s+){0,3}(?:says?|wrote|said|tells?|reminds?|stated)|as\s+it\s+says?|as\s+we\s+read|as\s+written|as\s+seen|(?<!gospel\s+)according\s+to|like\s+in|for\s+instance\s+in|for\s+example\s+in)\b/i.test(
          sentence,
        );
      // A book, its chapter and a verse: said every way a reference is. It
      // was plain only written "8:28" or with both "chapter" and "verse", and
      // "Psalm 23 verse 1", "Romans 8 verse 1" and "Genesis 3 16" were left
      // to the model, which called them mentions and showed nothing.
      //
      // Each said apart: "john 316" is read as John 3:16, and is a guess at
      // where the number divides — "psalm 151" is not Psalm 15:1.
      if (sung(sentence)) continue;
      let reference = named;
      if (named.verseStart === null) {
        // "Hebrews chapter 13, and then in verse 15": the verse later in the
        // sentence than the chapter it is in.
        const verse = sentence.match(/\bverses?\b(?![\s\S]*\bverses?\b)[\s\S]*$/i)?.[0];
        const within = verse && !OF_SOMETHING_ELSE.test(sentence) ? findRelativeReference(verse, named) : null;
        if (within?.verseStart) reference = within;
      }
      let saidIn = sentence;
      const before = sentences[index - 1] ?? "";
      if (
        reference.verseStart === null
        && /\bverses?\b/i.test(before)
        && !sung(before)
        && !OF_SOMETHING_ELSE.test(before)
        && !findBookNamed(before, books)
      ) {
        // "From verse 25 all the way to verse 32. Ephesians chapter 5.": the
        // verses said first, and the book and chapter they are in after.
        const within = findRelativeReference(before, named);
        if (within?.verseStart) {
          reference = within;
          saidIn = `${sentence} ${before}`;
        }
      }
      const said = numbersSaid(saidIn, { apart: true });
      const apart =
        reference.verseStart !== null
        && said.includes(reference.verseStart)
        && (said.includes(reference.chapter ?? 0) || reference.book?.chapters === 1);
      return { reference, plain: !isMentionFraming && apart };
    }
    if (
      !/\b(verses?|chapters?)\b/i.test(sentence)
      || sung(sentence)
      || OF_SOMETHING_ELSE.test(sentence)
    ) {
      continue;
    }
    let base: ParsedReference = open;
    let since = 0;
    /** A book named on its own before this, its chapter not yet known. */
    let alone = false;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const named = newestReferenceIn(sentences[previous] ?? "", books);
      if (named) {
        base = named;
        since = previous + 1;
        break;
      }
      const book = bookNamedAlone(sentences[previous] ?? "", books);
      if (book) {
        base = { book, chapter: book.chapters === 1 ? 1 : null, verseStart: null, verseEnd: null, versionCode: null, errors: [] };
        since = previous + 1;
        alone = base.chapter === null;
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
    // A book named straight after it is the book the verse is in ("…to verse
    // 32. Ephesians chapter 5."), not the passage open: wait for its chapter.
    if (sentences.slice(index + 1).some((later) => findBookNamed(later, books))) return null;
    if (alone) {
      // "The book of Ephesians." "Chapter 5." "Verse 28.": each read within
      // what the ones before it made.
      for (let at = since; at <= index; at += 1) {
        const said = sentences[at] ?? "";
        const saysChapter = /\bchapters?\b/i.test(said);
        if (base.chapter === null && !saysChapter) continue;
        const next = findRelativeReference(said, { ...base, chapter: base.chapter ?? 1 });
        if (next) base = next;
      }
      return base.chapter === null
        ? null
        : { reference: base, plain: base.verseStart !== null, within: true };
    }
    const relative = findRelativeReference(sentence, base);
    return relative ? { reference: relative, plain: true, within: true } : null;
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

/**
 * How many of the words come after the last one that could be part of a
 * reference: in "Genesis chapter 1 verse 1. In the beginning God", four. A
 * reference and the start of its reading can arrive in one message, and the
 * reading begins where the reference ends, not where the message does.
 */
export function wordsAfterLastCue(text: string, bookWords: Set<string>): number {
  const words = wordsOf(text);
  for (let at = words.length - 1; at >= 0; at -= 1) {
    const word = words[at] ?? "";
    if (/\d/.test(word) || NUMBER_WORDS.has(word) || PLACE_WORD.test(word) || bookWords.has(word)) {
      return words.length - 1 - at;
    }
  }
  return 0;
}

const ORDINAL_SAID: Record<string, string> = { "1": "first|1st|one", "2": "second|2nd|two", "3": "third|3rd|three" };

/**
 * Whether the words say the reference themselves: the book by name — "1
 * Kings" is not "2 Kings", nor "John" "1 John" — or, for a verse or chapter
 * said with none, within the passage `open`; then its chapter, and after it
 * its verse. "Matthew 4:10" does not say Matthew 1:1 or Matthew 4:4, and "we
 * have 3 pastors and 16 deacons" does not say John 3:16.
 *
 * For a passage somebody else names — the model — out of what was heard.
 */
export function saysReference(said: string, reference: ParsedReference, open: ParsedReference): boolean {
  const { book, chapter, verseStart, verseEnd } = reference;
  if (!book || !chapter) return false;
  const numbered = book.name.match(/^(\d)\s+(\S+)/);
  const first = (numbered?.[2] ?? book.name.split(/\s+/)[0] ?? "").toLowerCase();
  const name = `${first.replace(/s$/, "")}s?`;
  const ordinal = String.raw`(?:first|second|third|1st|2nd|3rd|[123])\s+(?:(?:book|epistle|letter)\s+(?:of|to)\s+)?`;
  const bookSaid = numbered
    ? new RegExp(String.raw`\b(?:${ORDINAL_SAID[numbered[1] ?? ""] ?? numbered[1]})\s+(?:(?:book|epistle|letter)\s+(?:of|to)\s+)?${name}\b`, "i").test(said)
    : new RegExp(String.raw`\b${name}\b`, "i").test(said)
      && !new RegExp(String.raw`\b${ordinal}${name}\b`, "i").test(said);
  const within = open.book?.id === book.id && /\b(?:verses?|chapters?)\b/i.test(said);
  if (!bookSaid && !within) return false;

  // The numbers after the book's name (all of them, with no name said).
  const from = bookSaid ? said.toLowerCase().search(new RegExp(String.raw`\b${name}\b`, "i")) : 0;
  const numbers = numbersSaid(said.slice(Math.max(0, from) + (bookSaid ? first.length : 0)));
  // "Chapter three", "verse twenty eight" — and "the third chapter", "the
  // sixteenth verse", the number before the word.
  const labelled = (label: string, value: number) =>
    numbersSaid(
      [
        ...said.matchAll(
          new RegExp(
            String.raw`((?:[\p{L}\p{N}-]+\s+){0,2})\b${label}s?\b((?:\s+[\p{L}\p{N}-]+){0,4})`,
            "giu",
          ),
        ),
      ]
        .map((match) => `${match[1] ?? ""} . ${match[2] ?? ""}`)
        .join(" . "),
    ).includes(value);
  const chapterGiven = (within && open.chapter === chapter) || book.chapters === 1;
  const chapterAt = numbers.indexOf(chapter);
  if (chapterAt < 0 && !chapterGiven && !labelled("chapter", chapter)) return false;
  // Said straight after the name, a number is the chapter: "Jude 2:1" does
  // not say Jude 1:1.
  if (bookSaid && book.chapters === 1 && numbers.length > 1 && numbers[0] !== 1 && verseStart !== numbers[0]) {
    return false;
  }
  if (verseStart === null) return bookSaid;
  // The verse is the number said next after the chapter ("Genesis 7:14 …
  // according to its kind", heard "two its kind", does not say Genesis 7:2),
  // or the one called a verse.
  const next = chapterAt >= 0 ? numbers[chapterAt + 1] : undefined;
  const isVerse = (verse: number) =>
    labelled("verse", verse) && (chapterGiven || chapterAt >= 0 || labelled("chapter", chapter));
  if (next !== verseStart && !isVerse(verseStart)) return false;
  return verseEnd === null || numbers.includes(verseEnd) || isVerse(verseEnd);
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
    // "K J V", "k.j.v.", and the letters as the transcriber groups them:
    // "ES. V." went unnoticed until it was written "ESV". Not the letters
    // run together, which is the code itself: "net" is no Bible.
    if (/^[A-Z]{2,5}$/.test(upper)) {
      patterns.push(
        bounded(
          `(?!${escaped}(?![\\p{L}\\p{N}]))` + upper.split("").join(String.raw`[\s.]*`) + "\\.?",
          "i",
        ),
      );
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
 * Every pattern a Bible is said by, made once: they are matched at every word
 * heard, against every Bible installed and in the catalog. `matchAll` copies
 * a pattern before it matches, so one kept here is never left part-way.
 */
const namedPatternCache = new Map<string, RegExp[]>();
function namedPatterns(version: NamedVersion): RegExp[] {
  const key = JSON.stringify([version.code, version.name]);
  let patterns = namedPatternCache.get(key);
  if (!patterns) {
    patterns = [...patternsFor(version), ...saidInFull(version)];
    namedPatternCache.set(key, patterns);
  }
  return patterns;
}

/**
 * The installed Bible the words name last, or `null`: "in the New
 * International Version", "the KJV says", "K J V". Of two names ending in
 * the same place the longer wins, so "New King James Version" is the NKJV and
 * not the King James inside it.
 */
export function findNamedVersion(text: string, versions: NamedVersion[]): string | null {
  return lastNamedVersion(text, versions)?.code ?? null;
}

/** `findNamedVersion`, with the name as said and where it ends in `text`. */
export function lastNamedVersion(
  text: string,
  versions: NamedVersion[],
): { code: string; said: string; end: number } | null {
  let best: { code: string; end: number; length: number } | null = null;
  for (const version of versions) {
    for (const pattern of namedPatterns(version)) {
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
  return best ? { code: best.code, said: text.slice(best.end - best.length, best.end), end: best.end } : null;
}

/**
 * The Bible named by the words `text` begins with, or `null`: "ESV says",
 * "the New King James Version" (the longest name that begins there, so not
 * the King James inside it). For "in the ESV", where the name must be what
 * follows "in", not something said later in the sentence.
 */
export function namedVersionAt(text: string, versions: NamedVersion[]): string | null {
  return versionNamedAt(text, versions)?.code ?? null;
}

/**
 * `namedVersionAt`, with what follows the name: "Amplified version please"
 * is the AMP and " version please". "Amplified" on its own is the Amplified
 * Bible here, as it is nearly always said: only ever looked for where a
 * Bible is expected.
 */
export function versionNamedAt(
  text: string,
  versions: NamedVersion[],
): { code: string; said: string; rest: string } | null {
  const from = text.replace(/^\s*(?:the\s+)?/i, "");
  let best: { code: string; length: number } | null = null;
  for (const version of versions) {
    for (const pattern of namedPatterns(version)) {
      for (const match of from.matchAll(pattern)) {
        if (match.index !== 0) continue;
        if (!best || match[0].length > best.length) {
          best = { code: version.code, length: match[0].length };
        }
      }
    }
  }
  if (best) return { code: best.code, said: from.slice(0, best.length), rest: from.slice(best.length) };
  const amplified = /^amplified(?:\s+classic)?(?![\p{L}\p{N}])/iu.exec(from);
  if (!amplified) return null;
  const said = amplified[0];
  const code =
    namedVersionAt(`${said} Bible`, versions)
    ?? namedVersionAt(said.replace(/^amplified/i, "Amplified Bible"), versions);
  return code ? { code, said, rest: from.slice(said.length) } : null;
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

/**
 * Words that are in every other sentence, of the Bible and of a sermon: they
 * hold a sentence together and say nothing about which one it is. "And he
 * said unto them" is four of them; so is "one day a man".
 */
const TELLS_NOTHING = new Set(
  (
    "a about after again against all also am an and any are art as at away be because been before "
    + "being behold but by came can come cometh could day days did didst do does doeth done dost doth "
    + "down even every for forth "
    + "from gave get give go god goes going gone good got great had has hast hath have he her here "
    + "him himself his how i if in into is it its jesus let like lord made make man many may me men "
    + "might more must my neither no none nor not nothing now o of off on one only or other our out "
    + "over own "
    + "people put said saith same saw say saying says see shall shalt she should so some such take "
    + "tell than that the thee their them then there therefore these they thing things this those "
    + "thou though through thus thy time to told too took two unto up upon us very was way we went "
    + "were what when where which while who whom whose why will with without would ye yea yet you "
    + "your yours "
    // Counting is not telling: "my first point, my second point, and the
    // third" has the words of 1 Chronicles 12:9, and of nothing.
    + "three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred "
    + "thousand first second third fourth fifth sixth seventh eighth ninth tenth last next"
  ).split(" "),
);

/** Whether a word says something about which verse it is in. */
export function tells(word: string): boolean {
  return (
    word.length > 2
    && !TELLS_NOTHING.has(word)
    // "Times", "says", "gives": the same words with an "s".
    && !(word.endsWith("s") && TELLS_NOTHING.has(word.slice(0, -1)))
    && !/^\d+$/.test(word)
  );
}

/** Where the newest words are, in verses being read aloud. */
export type ReadingAt = {
  /** The verse the newest word is in. */
  verse: number;
  /** How many of the newest words follow the text, up to there. */
  matched: number;
  /** How many of those are that verse's own; the rest end the verse before. */
  intoVerse: number;
  /** Whether those begin the verse, rather than being from the middle of it. */
  fromStart: boolean;
  /** How many of the verse's own tell something (`tells`). */
  telling: number;
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
    if (best && (matched < best.matched || (matched === best.matched && place.verse !== stay))) {
      continue;
    }
    const intoVerse = Math.min(matched, place.at + 1);
    let telling = 0;
    for (let back = 0; back < intoVerse; back += 1) {
      if (tells(text[end - back]?.word ?? "")) telling += 1;
    }
    best = { verse: place.verse, matched, intoVerse, fromStart: matched >= place.at + 1, telling };
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
 * must have been read just before them, two words of it at least.
 *
 * Started after a pause, or with a chapter open and no verse, the words must
 * be where a verse begins and say something: four of them with one that
 * tells ("For God sent not"), or three with two. "And he said", "and God
 * said", "the son of" begin a hundred verses and as many sentences of a
 * sermon; three such words moved the screen on in the middle of one. Words
 * from the middle of a verse must be five, two of them telling. A verse
 * further on than the next needs more again — five from its start, seven
 * from its middle: reading does not skip a verse often, and "For it is
 * written" begins the verse after next as well as it is said in this one.
 */
export function movedOn(
  at: ReadingAt,
  inView: number | null,
  firstWord: string | undefined,
): boolean {
  if (at.verse === inView) return false;
  if (inView !== null && at.verse < inView) return false;
  const next = inView === null || at.verse === inView + 1;
  const before = at.matched - at.intoVerse;
  if (next && inView !== null && before >= 2) {
    return at.intoVerse >= 2 || (at.intoVerse === 1 && !COMMON_OPENINGS.has(firstWord ?? ""));
  }
  if (at.fromStart) {
    return next
      ? (at.intoVerse >= 4 && at.telling >= 1) || (at.intoVerse >= 3 && at.telling >= 2)
      : at.intoVerse >= 5 && at.telling >= 2;
  }
  return next ? at.intoVerse >= 5 && at.telling >= 2 : at.intoVerse >= 7 && at.telling >= 3;
}
