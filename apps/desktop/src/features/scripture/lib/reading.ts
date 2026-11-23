/**
 * Knowing where a reading is: whether the words heard are still those of the
 * passage on screen, whether they have gone on into the next verse, and
 * whether they are the words of a verse somebody else — the model — says
 * they are.
 *
 * The Bible agent (`heard-scripture.ts`) finds verses three ways: a reference
 * said, words read aloud and found in the Bible (`verse-search-index.mjs`),
 * and the model's reading of what was meant. The last two find a verse by
 * its words, and words are shared: Matthew 22:37 is Deuteronomy 6:5 quoted,
 * "flesh of my flesh" runs into Psalm 73:26's "my flesh and my heart". So a
 * verse being read is held to until the reading leaves it, and a verse the
 * model names goes up only when what was said is in it.
 *
 * Nothing here knows how rare a word is in the Bible; it knows which words
 * tell nothing (`tells`, in `listening.ts`), and counts the rest.
 */

import { readingWords, tells } from "./listening";

export { tells };

const SAME_WORD: Record<string, string> = {
  shew: "show", shewed: "show", shewn: "show", spake: "spoke", thine: "your", abram: "abraham",
  fishes: "fish", loaves: "loaf", thieves: "thief", wives: "wife", lives: "life", children: "child",
  brethren: "brother", brothers: "brother",
};

/**
 * A word without the ending that changes between Bibles and tellings:
 * "believeth", "believes" and "believed" are one word; "father's" and
 * "fathers" another.
 */
export function rootOf(word: string): string {
  const same = SAME_WORD[word];
  if (same) return same;
  // A word that tells nothing is left as it is, to be known for one.
  if (!tells(word)) return word;
  let root = word;
  if (word.length > 4) {
    for (const ending of ["ings", "ing", "eth", "est", "ed", "es", "s"]) {
      if (word.endsWith(ending) && word.length - ending.length >= 3) {
        // "running" and "run".
        root = word.slice(0, -ending.length).replace(/([^aeiou])\1$/, "$1");
        break;
      }
    }
  }
  // "loved" and "love", "gives" and "give", "stones" and "stone".
  return root.length > 3 && root.endsWith("e") ? root.slice(0, -1) : root;
}

/** The roots of what was heard or written, in order. */
export function rootsOf(text: string): string[] {
  return readingWords(text).map(rootOf);
}

/** How many words two lists share in order, gaps allowed. */
function inOrder(a: string[], b: string[]): number {
  let previous = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/**
 * How much of `heard` follows `text` in order, gaps allowed: how many words,
 * and how many words that tell something — each the most there could be, the
 * telling ones counted among themselves.
 */
export function followed(heard: string[], text: string[]): { words: number; telling: number } {
  return {
    words: inOrder(heard, text),
    telling: inOrder(heard.filter(tells), text.filter(tells)),
  };
}

/** The newest words looked at to tell where a reading is. */
export const READING_TAIL = 10;

/**
 * Whether the newest words heard are still in `text` — the passage on screen
 * and the verse after it: read from it, in this Bible or another, or said
 * about it in its own words. Of the last ten heard: two words of it that
 * tell something, among four in its order; or six in its order, one of them
 * telling ("Jesus replied: love the Lord your God with all your", of Matthew
 * 22:37 in another Bible); or three that tell.
 *
 * While they are, nothing found by its words alone takes the screen
 * (`heard-scripture.ts`): a reference said still does.
 */
export function stillIn(heardRoots: string[], textRoots: string[]): boolean {
  const tail = heardRoots.slice(-READING_TAIL);
  const { words, telling } = followed(tail, textRoots);
  return telling >= 3 || (telling >= 2 && words >= 4) || (telling >= 1 && words >= 6);
}

/**
 * Whether most of what was heard since the passage went up is the passage:
 * half the last sixteen words in its order, two of them telling. A verse read
 * from another Bible shares its words a few at a time — never ten in a row —
 * and is being read all the same.
 */
export function mostlyIn(sinceRoots: string[], textRoots: string[]): boolean {
  const window = sinceRoots.slice(-16);
  if (window.length < 6) return false;
  const { words, telling } = followed(window, textRoots);
  return telling >= 2 && words * 2 >= window.length;
}

/**
 * Whether a reading that has been following the passage is following it
 * still: of everything heard since it went up (forty words at most), eight
 * words in its order with three that tell — and seven of the newest ten
 * among them.
 *
 * A verse can end in words that tell nothing — "I will be their God, and
 * they will be my people" — and one word into the next sentence none of the
 * last ten told anything: Jeremiah 31:33, read from a Bible that was not
 * installed, was left for Hebrews 8:10, which quotes it.
 */
export function followingStill(sinceRoots: string[], textRoots: string[]): boolean {
  const heard = sinceRoots.slice(-40);
  if (heard.length < 10) return false;
  const columns = textRoots.length + 1;
  const table = new Uint16Array((heard.length + 1) * columns);
  for (let i = 1; i <= heard.length; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      table[i * columns + j] =
        heard[i - 1] === textRoots[j - 1]
          ? (table[(i - 1) * columns + j - 1] ?? 0) + 1
          : Math.max(table[(i - 1) * columns + j] ?? 0, table[i * columns + j - 1] ?? 0);
    }
  }
  let words = 0;
  let telling = 0;
  let newest = 0;
  for (let i = heard.length, j = textRoots.length; i > 0 && j > 0; ) {
    if (heard[i - 1] === textRoots[j - 1]) {
      words += 1;
      if (tells(heard[i - 1] ?? "")) telling += 1;
      if (i > heard.length - 10) newest += 1;
      i -= 1;
      j -= 1;
    } else if ((table[(i - 1) * columns + j] ?? 0) >= (table[i * columns + j - 1] ?? 0)) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return words >= 8 && telling >= 3 && newest >= 7;
}

/**
 * Whether the newest words have left `current` for `next`, the verse after
 * it, when they are not word for word either's — read from another Bible, or
 * heard badly. The last eight words must follow the next verse by three
 * telling words at least, and by two more than they follow the one on screen.
 *
 * `sinceRoots`: only what was heard since `current` went up. The end of the
 * verse before it is not evidence of where the reading is now: a genealogy
 * ends every verse "and begot sons and daughters", and the words of one went
 * on counting towards the verse after next.
 */
export function goneOnTo(sinceRoots: string[], current: string[], next: string[]): boolean {
  if (sinceRoots.length < 4) return false;
  const tail = sinceRoots.slice(-8);
  const inNext = followed(tail, next);
  if (inNext.telling < 3) return false;
  return inNext.telling >= followed(tail, current).telling + 2;
}

/** How what was said bears a verse out. */
export type BorneOut =
  /** Words of it, in a row or nearly: it is being read. */
  | "read"
  /** Enough of what it says, in the speaker's own words. */
  | "told";

/** The longest run of words two texts share, in order and unbroken. */
function longestRun(a: string[], b: string[]): { length: number; telling: number; fromStart: boolean } {
  let best = { length: 0, telling: 0, fromStart: false };
  const run = new Uint16Array(b.length + 1);
  const worth = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonalRun = 0;
    let diagonalWorth = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const aboveRun = run[j] ?? 0;
      const aboveWorth = worth[j] ?? 0;
      if (a[i - 1] === b[j - 1]) {
        run[j] = diagonalRun + 1;
        worth[j] = diagonalWorth + (tells(a[i - 1] ?? "") ? 1 : 0);
      } else {
        run[j] = 0;
        worth[j] = 0;
      }
      if ((run[j] ?? 0) > best.length) {
        // Where the verse begins, give or take its first word ("And …").
        best = { length: run[j] ?? 0, telling: worth[j] ?? 0, fromStart: j - (run[j] ?? 0) <= 1 };
      }
      diagonalRun = aboveRun;
      diagonalWorth = aboveWorth;
    }
  }
  return best;
}

/** The fewest words said for them to be weighed as a telling of a verse. */
const TOLD_LEAST_WORDS = 7;

/**
 * Whether what was `said` is in the verse whose words are `text` — the check
 * a passage named by the model must pass before it is shown. The model reads
 * meaning; this reads the Bible. "One day a man" is in no verse the model
 * could name, however sure it is.
 *
 * The model is right far more often than not — in this app's own log of real
 * services it said "show this" thirty-six times and every one was the passage
 * — so this is not a second opinion on which verse is meant. It is what stops
 * the screen changing on the model's word alone.
 *
 * - **read**: five of the verse's words in a row with two that tell
 *   something ("by his stripes we are healed", from the end of Isaiah 53:5),
 *   or four where the verse begins or that are half of it; or eight words
 *   in the verse's order, four of them telling.
 * - **told**: seven words said at the least, and of those that tell
 *   something, four are the verse's and two in five of them or more — or
 *   three, and three in five — one of them a word of some length, which is
 *   as near as this comes to a rare one. "David took five smooth stones from
 *   the brook" has eight of 1 Samuel 17:40's; "one day a man came to my
 *   office" has none of any. Two are not enough: "when Bita asks Jesus how
 *   many times we should forgive his brother" is Matthew 18:21 with Peter's
 *   name heard wrong, and "forgive" and "brother" are in a hundred verses.
 *   That one waits in the box.
 */
export function borneOutBy(said: string, text: string): BorneOut | null {
  const saidRoots = rootsOf(said);
  const textRoots = rootsOf(text);
  const run = longestRun(saidRoots, textRoots);
  if (
    run.telling >= 2
    && (run.length >= 5 || (run.length >= 4 && (run.fromStart || run.length * 2 >= textRoots.length)))
  ) {
    return "read";
  }
  const inOrder = followed(saidRoots, textRoots);
  if (inOrder.words >= 8 && inOrder.telling >= 4) return "read";

  if (saidRoots.length < TOLD_LEAST_WORDS) return null;
  const saidTelling = new Set(saidRoots.filter(tells));
  if (saidTelling.size < 3) return null;
  const inVerse = new Set(textRoots);
  let shared = 0;
  let long = 0;
  for (const root of saidTelling) {
    if (!inVerse.has(root)) continue;
    shared += 1;
    if (root.length >= 6) long += 1;
  }
  if (long < 1) return null;
  return (shared >= 4 && shared * 5 >= saidTelling.size * 2)
    || (shared >= 3 && shared * 5 >= saidTelling.size * 3)
    ? "told"
    : null;
}

/** The most words of a verse said in order that bear a suggestion out, however long the verse. */
const BORNE_OUT_WORDS = 10;
/** The most of its telling words, likewise. */
const BORNE_OUT_TELLING = 6;

/**
 * Whether what was said since a verse was suggested — from the words that
 * suggested it, across pauses — says it is that verse, and not one of the
 * `rivals` its first words also began. Then it goes on screen.
 *
 * "In the beginning" suggests Genesis 1:1; "God created the heavens and the
 * earth", a breath later, is the rest of it. Not word for word ("heavens",
 * where the King James has "heaven"), which is what a quote found by its
 * words alone must be (`verse-search-index.mjs`); word for word or not, the
 * verse is being read.
 *
 * Of the verse: six-tenths of its words in its order (ten at most) and
 * seven-tenths of the words in it that tell something (four at least, six at
 * most), with the newest words among them (`stillIn`). Of what was said: two
 * words in three the verse's — an aside, not a story of its own. And two
 * more telling words of it than of any rival: "in the beginning God created"
 * is not John 1:1. "Lift up your hands and praise the Lord" has two of
 * Psalm 134:2's four, and stays a suggestion.
 */
export function bearsOutSuggestion(saidRoots: string[], verseRoots: string[], rivals: string[][]): boolean {
  const { words, telling } = followed(saidRoots, verseRoots);
  const verseTelling = verseRoots.filter(tells).length;
  if (words < Math.min(BORNE_OUT_WORDS, Math.max(5, Math.ceil(verseRoots.length * 0.6)))) return false;
  if (telling < Math.min(BORNE_OUT_TELLING, Math.max(4, Math.ceil(verseTelling * 0.7)))) return false;
  if (words * 3 < saidRoots.length * 2) return false;
  if (!stillIn(saidRoots, verseRoots)) return false;
  return rivals.every((rival) => followed(saidRoots, rival).telling + 2 <= telling);
}
