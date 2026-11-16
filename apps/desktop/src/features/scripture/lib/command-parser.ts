/**
 * Deterministic command parser for spoken Scripture commands.
 *
 * Separates explicit commands from inferred intent:
 * - "Next verse" / "Previous verse"
 * - "Go to Romans 8:28" / "Turn to Genesis chapter one"
 * - "Show verse twelve" / "Look at verse 12"
 * - "Switch to NIV" / "Read that in the Amplified" / "Give me KJV"
 *
 * Validates permissions, valid numbers, and mode separation.
 */

import type { BibleBookRecord } from "./db";
import { findNamedVersion, namedVersionAt, type NamedVersion } from "./listening";
import { parseReference, type ParsedReference } from "./parser";

export type ExplicitCommand =
  | { type: "next_verse" }
  | { type: "previous_verse" }
  | { type: "navigate_passage"; reference: ParsedReference }
  | { type: "navigate_verse"; verse: number }
  | { type: "switch_version"; versionCode: string };

const SPOKEN_NUMBER_MAP: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/** Normalize spoken numbers like "twelve", "twenty eight" to integer. */
export function parseSpokenNumber(tokenOrPhrase: string): number | null {
  const trimmed = tokenOrPhrase.trim().toLowerCase();
  const directNum = parseInt(trimmed, 10);
  if (!Number.isNaN(directNum) && String(directNum) === trimmed) {
    return directNum;
  }
  const parts = trimmed.split(/[\s-]+/).filter(Boolean);
  let total = 0;
  let current = 0;
  for (const part of parts) {
    if (part === "and") continue;
    const val = SPOKEN_NUMBER_MAP[part];
    if (val === undefined) {
      const num = parseInt(part, 10);
      if (Number.isNaN(num)) return null;
      current += num;
      continue;
    }
    if (val === 100) {
      current = (current || 1) * 100;
    } else if (val >= 20) {
      current += val;
    } else {
      current += val;
    }
  }
  total += current;
  return total > 0 ? total : null;
}

/** Common speech recognition errors for Bible book names. */
const BOOK_SPEECH_FIXES: [RegExp, string][] = [
  [/\b(?:have\s+a\s+cook|habacuc|habacook)\b/gi, "Habakkuk"],
  [/\b(?:songs?\s+of\s+solomon|canticles?)\b/gi, "Song of Solomon"],
  [/\b(?:revelations)\b/gi, "Revelation"],
  [/\b(?:psalm)\b(?=\s+\d)/gi, "Psalms"],
  [/\b(?:proverb)\b(?=\s+\d)/gi, "Proverbs"],
  [/\b(?:first|1st)\s+john\b/gi, "1 John"],
  [/\b(?:second|2nd)\s+john\b/gi, "2 John"],
  [/\b(?:third|3rd)\s+john\b/gi, "3 John"],
  [/\b(?:first|1st)\s+corinthians?\b/gi, "1 Corinthians"],
  [/\b(?:second|2nd)\s+corinthians?\b/gi, "2 Corinthians"],
  [/\b(?:first|1st)\s+thessalonians?\b/gi, "1 Thessalonians"],
  [/\b(?:second|2nd)\s+thessalonians?\b/gi, "2 Thessalonians"],
  [/\b(?:first|1st)\s+timothy\b/gi, "1 Timothy"],
  [/\b(?:second|2nd)\s+timothy\b/gi, "2 Timothy"],
  [/\b(?:first|1st)\s+peter\b/gi, "1 Peter"],
  [/\b(?:second|2nd)\s+peter\b/gi, "2 Peter"],
  [/\b(?:first|1st)\s+kings?\b/gi, "1 Kings"],
  [/\b(?:second|2nd)\s+kings?\b/gi, "2 Kings"],
  [/\b(?:first|1st)\s+chronicles?\b/gi, "1 Chronicles"],
  [/\b(?:second|2nd)\s+chronicles?\b/gi, "2 Chronicles"],
  [/\b(?:first|1st)\s+samuel\b/gi, "1 Samuel"],
  [/\b(?:second|2nd)\s+samuel\b/gi, "2 Samuel"],
];

export function normalizeSpeechErrors(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of BOOK_SPEECH_FIXES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

const NEXT_VERSE = /\b(?:next|forward)\s+(?:verse|scripture)\b/i;
const PREVIOUS_VERSE =
  /\b(?:prev|previous|backward)\s+(?:verse|scripture)\b|\bback\s+(?:one\s+|a\s+)?(?:verse|scripture)\b|\bback\s+to\s+the\s+last\s+(?:verse|scripture)\b/i;

/**
 * The first "next verse" or "previous verse" in the words, and how many of
 * the words it takes up, counting from the first.
 *
 * A turn is heard again and again as it grows ("Next verse", "Next verse
 * please", "Next verse please, let us"), and stepping is the one command
 * that does something different each time it is acted on: one "next verse"
 * went on five verses. Whoever acts on it leaves out the words it took up
 * the next time the turn is read (`heard-scripture.ts`).
 *
 * "The last verse" on its own is not a step back: it is as often the last
 * verse of the chapter, or the one read last week.
 */
export function findStepCommand(
  text: string,
): { type: "next_verse" | "previous_verse"; words: number } | null {
  const next = NEXT_VERSE.exec(text);
  const previous = PREVIOUS_VERSE.exec(text);
  const found =
    next && (!previous || next.index <= previous.index)
      ? { type: "next_verse" as const, match: next }
      : previous
        ? { type: "previous_verse" as const, match: previous }
        : null;
  if (!found) return null;
  const upTo = text.slice(0, found.match.index + found.match[0].length);
  return { type: found.type, words: upTo.trim().split(/\s+/).length };
}

/**
 * Recognizes explicit commands deterministically.
 */
export function parseExplicitCommand(
  rawText: string,
  options: {
    books: BibleBookRecord[];
    versions: NamedVersion[];
    activePassage?: ParsedReference | null;
  },
): ExplicitCommand | null {
  const text = normalizeSpeechErrors(rawText.trim());
  if (!text) return null;

  // 1, 2. Next and previous verse (`findStepCommand`).
  const step = findStepCommand(text);
  if (step) return { type: step.type };

  // 3. Explicit version change commands:
  // Must use an imperative/version-change phrase:
  // "switch to NIV", "change to ESV", "read that in the Amplified", "read in KJV", "give me KJV"
  const versionCommandMatch = text.match(
    /\b(?:switch\s+(?:the\s+)?(?:version\s+to|translation\s+to|to)|change\s+(?:the\s+)?(?:version\s+to|translation\s+to|to)|read\s+(?:that|this|it)\s+in(?:\s+the)?|let['’]?s\s+read(?:\s+(?:that|this|it))?\s+in(?:\s+the)?|give\s+me(?:\s+in)?(?:\s+the)?)\s+(.+?)[.!]?$/i,
  );
  if (versionCommandMatch) {
    const rawTarget = versionCommandMatch[1]?.trim() ?? "";
    let candidateCode = findNamedVersion(rawTarget, options.versions);
    if (!candidateCode) {
      // Check if target matches with "version" or "bible" appended (e.g. "the Amplified" -> "Amplified Bible")
      candidateCode = findNamedVersion(`${rawTarget} version`, options.versions) ??
        findNamedVersion(`${rawTarget} bible`, options.versions);
    }
    if (candidateCode) {
      return { type: "switch_version", versionCode: candidateCode };
    }
  }

  // 3b. A Bible named after "in": "John 3:16 in the ESV", "in ESV", "what
  // does it say in the King James?". It was only "give me ESV", "switch to"
  // and "read that in": said the way a preacher says it, nothing happened.
  // The name must be what follows "in" — "in the message this morning" names
  // no Bible, and "the Message" is one only said as one ("the Message
  // Bible"), like every Bible whose name is also a word.
  let named: string | null = null;
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])in\s+(?:the\s+)?/giu)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    const code =
      namedVersionAt(after, options.versions)
      // "In the Amplified", as it is nearly always said.
      ?? (/^amplified(?:\s+classic)?(?![\p{L}\p{N}])/iu.test(after)
        ? namedVersionAt(after.replace(/^(amplified(?:\s+classic)?)/i, "$1 Bible"), options.versions)
          ?? namedVersionAt(after.replace(/^amplified/i, "Amplified Bible"), options.versions)
        : null);
    if (code) named = code;
  }
  if (named) {
    return { type: "switch_version", versionCode: named };
  }

  // 4. Relative verse within active passage:
  // Requires an imperative phrase: "show verse 12", "go to verse 12", "look at verse twelve",
  // "give me verse 23", or standalone "verse 12" as its own command.
  // Must NOT match inside full references like "Genesis chapter 1 verse 1".
  const relativeVerseMatch =
    text.match(/\b(?:show\s+(?:me\s+)?|go\s+to\s+|look\s+at\s+|read\s+|turn\s+to\s+|give\s+me\s+)verses?\s+(\d+|[a-z]+)\b/i) ??
    text.match(/^(?:please\s+)?verses?\s+(\d+|[a-z]+)[.!]?$/i);
  if (relativeVerseMatch && options.activePassage?.book && options.activePassage.chapter) {
    const verseNum = parseSpokenNumber(relativeVerseMatch[1] ?? "");
    if (verseNum !== null && verseNum >= 1 && verseNum <= 176) {
      return { type: "navigate_verse", verse: verseNum };
    }
  }

  // 5. Explicit navigation commands to passage:
  // "turn to Romans 8:28", "go to Romans 8:28", "open your Bibles to Romans 8:28", "turn with me to Genesis chapter 1"
  const navigationPromptMatch = text.match(
    /\b(?:turn\s+to|turn\s+with\s+me\s+to|open\s+your\s+bibles?\s+to|open\s+to|go\s+to|let['’]?s\s+turn\s+to|let['’]?s\s+read|please\s+show|show)\s+(.+)$/i,
  );
  if (navigationPromptMatch) {
    const remainder = navigationPromptMatch[1]?.trim() ?? "";
    const parsed = parseReference(remainder, options.books);
    if (parsed.book && parsed.chapter && parsed.errors.length === 0) {
      // If remainder contains verse words but parseReference failed to find a verseStart,
      // it is said sideways (e.g. "and the 3rd verse"), so let model/quote-finder handle it.
      if (/\bverses?\b/i.test(remainder) && parsed.verseStart === null) {
        return null;
      }
      return { type: "navigate_passage", reference: parsed };
    }
  }

  return null;
}
