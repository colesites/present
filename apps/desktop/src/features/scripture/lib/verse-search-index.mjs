import { wellKnownRank } from "./well-known-verses.mjs";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "for", "from", "i", "in",
  "is", "it", "me", "my", "of", "on", "or", "show", "that", "the", "their",
  "them", "there", "these", "this", "those", "to", "us", "was", "we", "what",
  "where", "which", "who", "with", "you", "your",
]);

export function normalizeVerseSearchText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value, includeStopWords = false) {
  const seen = new Set();
  const tokens = [];
  for (const token of normalizeVerseSearchText(value).split(" ")) {
    if (token.length < 2 || (!includeStopWords && STOP_WORDS.has(token)) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function addToIndex(index, verses) {
  for (const verse of verses) {
    const at = index.entries.length;
    const entry = { normalizedText: normalizeVerseSearchText(verse.text), verse };
    index.entries.push(entry);
    for (const token of tokenize(entry.normalizedText, true)) {
      const list = index.postings.get(token);
      if (list) list.push(at);
      else index.postings.set(token, [at]);
    }
  }
}

export function buildVerseSearchIndex(verses) {
  const index = { entries: [], postings: new Map() };
  addToIndex(index, verses);
  return index;
}

/** Verses indexed between pauses: a few milliseconds' work each. */
const INDEX_STEP = 2_000;

/**
 * `buildVerseSearchIndex`, a step at a time with `pause` between: a whole
 * Bible at once held the tab still for a few hundred milliseconds, once for
 * every Bible installed as listening started.
 */
export async function buildVerseSearchIndexInSteps(verses, pause) {
  const index = { entries: [], postings: new Map() };
  for (let from = 0; from < verses.length; from += INDEX_STEP) {
    addToIndex(index, verses.slice(from, from + INDEX_STEP));
    await pause();
  }
  return index;
}

function collectCandidateIndexes(index, tokens, mode) {
  const candidateIndexes = new Set();
  const tokensToCollect = mode === "exact" ? tokens.slice(0, 1) : tokens;
  for (const token of tokensToCollect) {
    const exact = index.postings.get(token);
    if (exact) {
      exact.forEach((entryIndex) => candidateIndexes.add(entryIndex));
      continue;
    }
    if (token.length < 3) continue;
    for (const [indexedToken, entryIndexes] of index.postings) {
      if (!indexedToken.startsWith(token)) continue;
      entryIndexes.forEach((entryIndex) => candidateIndexes.add(entryIndex));
    }
  }
  return [...candidateIndexes];
}

export function searchVerseIndex(index, input) {
  const normalizedQuery = normalizeVerseSearchText(input.query);
  const mode = input.mode === "exact" ? "exact" : "broad";
  const limit = Number.isFinite(input.limit) ? Math.max(1, input.limit) : 50;
  if (normalizedQuery.length < 2) return [];

  const rawTokens = tokenize(normalizedQuery, true);
  const meaningfulTokens = tokenize(normalizedQuery);
  const rankingTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
  const candidates = collectCandidateIndexes(index, rawTokens, mode);
  const matches = [];

  for (const entryIndex of candidates) {
    const entry = index.entries[entryIndex];
    const exactIndex = entry.normalizedText.indexOf(normalizedQuery);
    if (mode === "exact") {
      if (exactIndex >= 0) matches.push({ entry, score: 10_000 - exactIndex });
      continue;
    }

    let matchedTokens = 0;
    let score = exactIndex >= 0 ? 1_000 - Math.min(exactIndex, 400) : 0;
    let previousPosition = -1;
    let orderedPairs = 0;
    for (const token of rankingTokens) {
      const position = entry.normalizedText.indexOf(token);
      if (position < 0) continue;
      matchedTokens += 1;
      const frequency = index.postings.get(token)?.length ?? index.entries.length;
      const rarity = Math.log2((index.entries.length + 1) / (frequency + 1));
      score += 50 + Math.round(rarity * 12) + Math.min(token.length, 10);
      if (previousPosition >= 0 && position > previousPosition) orderedPairs += 1;
      previousPosition = position;
    }

    const coverage = matchedTokens / Math.max(1, rankingTokens.length);
    if (exactIndex < 0 && coverage < 0.34) continue;
    score += Math.round(coverage * 300) + orderedPairs * 25;
    if (entry.normalizedText.startsWith(normalizedQuery)) score += 100;
    matches.push({ entry, score });
  }

  matches.sort((left, right) =>
    right.score - left.score || String(left.entry.verse.pk).localeCompare(String(right.entry.verse.pk))
  );
  return matches.slice(0, limit).map((match) => match.entry.verse);
}

/**
 * The fewest words in a row that make a quote of a verse longer than this —
 * when no other verse has as many of them in a row: "Let there be light",
 * "I am the way", "Be still and know". It was five, and a preacher saying
 * the first words of a verse waited for the rest.
 *
 * Not three. Measured on the whole King James with fifty things a preacher
 * says that quote nothing, three words put a verse on screen for two of them
 * ("I remember the first time…" was Psalm 143:5, "…from the book of Romans"
 * Matthew 1:1); four, beginning as `QUOTE_ANYWHERE_RUN` says, for none.
 * Fewer words than this — "In the beginning", "God so loved", which open
 * more than one verse anyway — are the model's to read when the preacher
 * pauses (`lib/heard-scripture.ts`).
 */
export const QUOTE_MIN_RUN = 4;

/**
 * Words in a row that make a quote wherever they fall. Fewer must begin
 * where the sentence heard begins, or where the verse does: "…when I was a
 * young man" shares four words with Judges 17:7 in the middle of both, and
 * is not a quote of it; "Let there be light" and "Be still and know" are
 * said as a sentence of their own. With four words and no such rule,
 * twenty-five things a preacher says put Judges 17:7 up once; with it, the
 * fifty in `QUOTE_MIN_RUN`'s measure put up nothing they did not quote.
 */
export const QUOTE_ANYWHERE_RUN = 5;

/** A word in more than this share of verses is too common to look a quote up by. */
const COMMON_SHARE = 0.02;

const wordsOf = (normalized) => normalized.split(" ").filter(Boolean);

/**
 * The longest run of words two texts share, in order and unbroken: its length,
 * and where it ends in `a`.
 */
function longestSharedRun(a, b) {
  let best = { length: 0, end: 0, endInB: 0 };
  const run = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = run[j];
      run[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (run[j] > best.length) best = { length: run[j], end: i, endInB: j };
      diagonal = above;
    }
  }
  return best;
}

/** Whether the ascending `list` holds `value`. */
function holds(list, value) {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle] === value) return true;
    if (list[middle] < value) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

/**
 * The `candidates` that could hold a quote still being read: two words or
 * more of it, ending within the last `endingWithin` words heard. Such a verse
 * has the last two words of that run in it, so it is in the postings of the
 * rarer of them, for one of the places the run can end.
 *
 * Only ever leaves out a verse `endsWithPhraseOf` would turn away. Every
 * word of a quote in an uncommon word's verses, in every Bible installed, at
 * every word a preacher says, was most of the Bible screen's time while the
 * agent listened to a live sermon: some 1,900 verses a Bible at each word.
 */
function stillBeingRead(index, candidates, heardWords, endingWithin) {
  const lists = [];
  for (let end = heardWords.length; end >= Math.max(2, heardWords.length - endingWithin); end -= 1) {
    // One letter is not indexed (`tokenize`): those words cannot narrow it.
    const indexed = [heardWords[end - 2], heardWords[end - 1]].filter((word) => word.length >= 2);
    if (indexed.length === 0) return candidates;
    const rarest = indexed
      .map((word) => index.postings.get(word) ?? [])
      .reduce((rarer, list) => (list.length < rarer.length ? list : rarer));
    lists.push(rarest);
  }
  const listed = lists.reduce((total, list) => total + list.length, 0);
  if (listed < candidates.size) {
    const kept = new Set();
    for (const list of lists) {
      for (const entryIndex of list) if (candidates.has(entryIndex)) kept.add(entryIndex);
    }
    return kept;
  }
  const kept = [];
  for (const entryIndex of candidates) {
    if (lists.some((list) => holds(list, entryIndex))) kept.push(entryIndex);
  }
  return kept;
}

function countSpaces(text) {
  let spaces = 0;
  for (let at = text.indexOf(" "); at !== -1; at = text.indexOf(" ", at + 1)) spaces += 1;
  return spaces;
}

/**
 * Whether the verse's normalized `text` holds, as whole words, the `length`
 * words `a` ends with, give or take its last `endingWithin` — what a quote
 * being read now must have.
 *
 * Looked for in the text as it is, unsplit. Splitting every candidate into
 * words to compare them, at every word a preacher says, in every Bible
 * installed, held the Bible screen still while the agent listened to a live
 * sermon.
 */
function endsWithPhraseOf(a, text, length, endingWithin) {
  for (let end = a.length; end >= Math.max(length, a.length - endingWithin); end -= 1) {
    const phrase = a.slice(end - length, end).join(" ");
    if (
      text === phrase
      || text.startsWith(`${phrase} `)
      || text.endsWith(` ${phrase}`)
      || text.includes(` ${phrase} `)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where each sentence begins, as word positions in `wordsOf(normalize(text))`
 * — and, when the text ends with a full stop, where the next would. `ends`:
 * what ends one; with a comma in it, where each clause begins.
 */
function sentenceStarts(text, ends = /[.!?;:]+(?=\s|$)/) {
  const starts = new Set([0]);
  let count = 0;
  for (const sentence of text.split(ends)) {
    starts.add(count);
    count += wordsOf(normalizeVerseSearchText(sentence)).length;
  }
  return starts;
}

/**
 * How much a word says about which verse is meant, in bits: none for a word
 * in every verse, about fifteen for one in a single verse. "My flesh and my"
 * is four words and thirteen bits, nearly all of them in "flesh"; "for God so
 * loved the world" is six words and twenty-five.
 *
 * A Bible of a few verses (a test's) is weighed as a whole one would be, so
 * that a word in one verse of five is still a rare word. A New Testament
 * alone is weighed as what it is: counted as a whole Bible, every word of it
 * looked a bit and a third rarer than it is, and "at the end of the day" was
 * nearly a quote of Matthew 27:57 in the Passion Translation.
 */
function bitsOf(index, word) {
  index.bits ??= new Map();
  let bits = index.bits.get(word);
  if (bits === undefined) {
    const verses = index.postings.get(word)?.length ?? 0;
    const all = index.entries.length < 2_000 ? 31_000 : index.entries.length;
    bits = verses === 0 ? 0 : Math.log2(all / verses);
    index.bits.set(word, Math.max(0, bits));
  }
  return bits;
}

/**
 * How much the words of a run must say between them, in bits, to be a quote
 * of a verse and not a turn of phrase a verse happens to share — when they
 * are where the verse begins, or most of it, which is how a verse is read.
 *
 * Measured over the Bibles in `apps/desktop/bible/` (`tests/bible-agent-eval`):
 * at every word of 300 things said in services that quote nothing — 180 of
 * them from this app's own log of real ones — in the KJV, the NKJV and the
 * NIV, the most a run from a verse's start said was 23 bits ("What shall we
 * say then?", "And when he had finished,") — and against all thirteen Bibles
 * here, 23 again ("The woman said to her husband,", 2 Kings 4:9 in the
 * Easy-to-Read). The first eight words of a verse say 35 at the median, and
 * 25 or more for nineteen verses in twenty.
 */
export const QUOTE_MIN_BITS = 26;

/**
 * The same, for words from the middle of a verse. Speech shares more with
 * the middles of verses than with their beginnings: "…is that we should love
 * one another" is 29 bits of 1 John 3:11, "one day a man was walking along
 * the road" 28 of 2 Kings 2:23, and neither is being read. Eight words from
 * the middle of a verse say 37 at the median; a verse quoted from its middle
 * goes up a word or two later than one read from its start.
 */
export const QUOTE_MIN_BITS_MIDDLE = 34;

/**
 * From the middle of a verse still, but this many words of it in a row: so
 * many say more together than their bits add up to, which count each word as
 * if the ones before it were not there. In 300 things said in services,
 * against thirteen Bibles, no run reached eight words; the six that reached
 * seven said 25 bits at most. "The Lord is my shepherd, I shall not want" is
 * nine words and 28.
 */
export const QUOTE_LONG_RUN = 8;
export const QUOTE_MIN_BITS_LONG = 28;

/** How much of a verse the words must be to count as most of it. */
const MOST_OF_A_VERSE = 0.6;

/** What a whole verse of four words or fewer must say: "Jesus wept" is 14. */
export const SHORT_VERSE_MIN_BITS = 12;

/**
 * The fewest words in a row that suggest a verse, in the box and never on
 * screen: "In the beginning", "For God so", "Be still and".
 */
export const SUGGEST_MIN_RUN = 3;

/**
 * How much the first words of a verse must say, in bits, to suggest it —
 * not to show it, which takes `QUOTE_MIN_BITS`. The first words of the
 * verses preachers quote most say 8 to 20: "In the beginning" 10, "Be still
 * and" 10 to 11, "The Lord is my shepherd" 18. Fewer than that, and every
 * "the Lord is my" filled the box.
 *
 * Only where a verse begins: a suggestion is a verse begun. Words from the
 * middle of verses filled the box for half of what a preacher says that
 * quotes nothing ("one day a man was walking along the road", 2 Kings 2:23)
 * — unless they begin what is said, and the verse is one preachers quote
 * most (`well-known-verses.mjs`): "Let there be light", from the middle of
 * Genesis 1:3.
 */
export const SUGGEST_MIN_BITS = 10;

/**
 * By how much a suggested verse must out-say the next most likely — or be
 * the best known of those it does not (`well-known-verses.mjs`).
 */
export const SUGGEST_MARGIN_BITS = 3;

/** The most other verses a suggestion is told apart from (`rivals`). */
const SUGGEST_RIVALS = 6;

/**
 * By how much the verse found must out-say the next most likely. Two verses
 * that share the words heard so far are told apart by the word that comes
 * next, and a word like "and" or "the" tells nothing: the verse waits for a
 * word that does, rather than going up and being taken down again.
 */
export const QUOTE_MARGIN_BITS = 6;

/**
 * The one verse a sentence quotes, word for word, or `null`.
 *
 * For the listening agent, which reads what was heard without a model: "For
 * God so loved the world" said aloud is John 3:16 though no reference was
 * named. A verse counts as quoted when the sentence has words of it in a row
 * that say enough between them (`QUOTE_MIN_BITS`, and more from the middle
 * of a verse: `QUOTE_MIN_BITS_MIDDLE`) — four at the least, and
 * fewer than `QUOTE_ANYWHERE_RUN` only where a sentence or the verse begins —
 * or has all of a short verse as a sentence of its own ("Jesus wept."). A
 * quote more than one verse has equally ("his mercy endureth for ever", "in
 * the beginning"), or nearly (`QUOTE_MARGIN_BITS`), finds none of them rather
 * than a guess: the model is asked about those (`lib/heard-scripture.ts`).
 *
 * `commonAfter`: a word in more verses than this is too common to look a
 * verse up by; by default 2% of the Bible, and never fewer than 50 verses.
 *
 * `endingWithin`: only a quote that ends this many words or fewer before
 * the end of what was heard — one being read now, not one read a moment ago
 * that the preacher has since moved on from.
 *
 * `ended`: whether what was heard is all of it (the turn is over, or the
 * words were typed). While it is still being said, a short verse waits for
 * the full stop after it.
 *
 * `minBits`, `middleBits`, `marginBits`: in place of `QUOTE_MIN_BITS`,
 * `QUOTE_MIN_BITS_MIDDLE` and `QUOTE_MARGIN_BITS`, to measure with.
 *
 * `suggest`: when no verse is quoted, the verse the words most likely begin
 * to quote, if any (`suggestedFrom`), with `sure: false`. For the box, never
 * the screen.
 */
export function findQuotedVerse(index, heard, options = {}) {
  return quotedVerseMatch(index, heard, options)?.verse ?? null;
}

/**
 * `findQuotedVerse`, with how many words in a row the quote shares with the
 * verse (`run`), how many in order, gaps allowed (`shared`), and how much the
 * run says (`bits`) — so the same quote can be weighed across Bibles
 * (`chooseAcrossBibles`).
 *
 * @param {any} index
 * @param {string} heard
 * @param {{ commonAfter?: number, endingWithin?: number, ended?: boolean, minBits?: number, middleBits?: number, marginBits?: number, suggest?: boolean }} [options]
 */
export function quotedVerseMatch(
  index,
  heard,
  {
    commonAfter,
    endingWithin,
    ended = true,
    minBits = QUOTE_MIN_BITS,
    middleBits = QUOTE_MIN_BITS_MIDDLE,
    marginBits = QUOTE_MARGIN_BITS,
    suggest = false,
  } = {},
) {
  const heardWords = wordsOf(normalizeVerseSearchText(heard));
  if (heardWords.length < 2) return null;
  const begins = sentenceStarts(heard);
  const clauses = sentenceStarts(heard, /[.!?;:,]+(?=\s|$)/);

  const tooCommon = commonAfter ?? Math.max(50, index.entries.length * COMMON_SHARE);
  const isUncommon = (word) => {
    if (word.length < 3 || STOP_WORDS.has(word)) return false;
    const entryIndexes = index.postings.get(word);
    return Boolean(entryIndexes) && entryIndexes.length <= tooCommon;
  };

  const candidates = new Set();
  for (const word of new Set(heardWords)) {
    if (isUncommon(word)) index.postings.get(word).forEach((entryIndex) => candidates.add(entryIndex));
  }

  // The most any verse's run says, and the next most, whether or not either
  // would do as a quote: a verse is not found while another has as much of
  // what was heard, wherever in it the words fall.
  let top = null;
  let nextBits = 0;
  /** With `suggest`: every verse with a run long enough to suggest it. */
  const runs = [];
  const reading =
    endingWithin === undefined
      ? candidates
      : stillBeingRead(index, candidates, heardWords, endingWithin);
  for (const entryIndex of reading) {
    const entry = index.entries[entryIndex];
    const text = entry.normalizedText;
    // Normalized text is words with one space between: no need to split it
    // to count them.
    const count = text ? countSpaces(text) + 1 : 0;
    const needed = Math.max(2, Math.min(count, QUOTE_MIN_RUN));
    // A suggestion takes fewer words in a row; a phrase that ends a run of
    // `needed` ends one of fewer, so the quotes found are the same.
    const fewest = suggest ? Math.max(2, Math.min(count, SUGGEST_MIN_RUN)) : needed;
    // Turned away below anyway; this only does it before the long part. The
    // phrase is looked for in the verse's text as it is: most candidates go
    // here, every one of them, at every word heard, in every Bible installed.
    if (endingWithin !== undefined && !endsWithPhraseOf(heardWords, text, fewest, endingWithin)) {
      continue;
    }
    const verseWords = wordsOf(text);
    const run = longestSharedRun(heardWords, verseWords);
    if (run.length < fewest) continue;
    if (endingWithin !== undefined && heardWords.length - run.end > endingWithin) continue;
    const from = run.end - run.length;
    const said = heardWords.slice(from, run.end);
    let bits = 0;
    for (const word of said) bits += bitsOf(index, word);
    if (suggest) {
      const fromStart = run.endInB === run.length;
      const short = run.length === verseWords.length && run.length <= QUOTE_MIN_RUN;
      runs.push({
        verse: entry.verse,
        bits,
        run: run.length,
        fromStart,
        // Words from where the run begins to the newest heard.
        fromEnd: heardWords.length - from,
        // Up to the newest word, or the one before it: what is being said
        // now, not a phrase a breath ago ("…and I saw something. In the").
        now: heardWords.length - run.end <= 1,
        suggests:
          said.some(isUncommon)
          && (fromStart || (begins.has(from) && wellKnownRank(entry.verse) !== null))
          && (!short || clauses.has(from))
          && bits >= SUGGEST_MIN_BITS,
      });
    }
    if (run.length < needed) continue;
    if (top && bits <= top.bits) {
      nextBits = Math.max(nextBits, bits);
      continue;
    }
    nextBits = top?.bits ?? 0;

    const whole = run.length === verseWords.length;
    const short = whole && run.length <= QUOTE_MIN_RUN;
    const fromStart = run.endInB === run.length;
    // A verse this short is a quote only as a sentence of its own: "Jesus
    // wept." is John 11:35; "and Jesus wept over the city" tells Luke 19.
    const placed = short
      ? clauses.has(from) && (begins.has(run.end) || (ended && run.end === heardWords.length))
      : run.length >= Math.min(verseWords.length, QUOTE_ANYWHERE_RUN) || begins.has(from) || fromStart;
    const least = short
      ? SHORT_VERSE_MIN_BITS
      : fromStart || run.length >= verseWords.length * MOST_OF_A_VERSE
        ? minBits
        : run.length >= QUOTE_LONG_RUN
          ? Math.min(middleBits, QUOTE_MIN_BITS_LONG)
          : middleBits;
    top = {
      verse: entry.verse,
      bits,
      run: run.length,
      words: verseWords,
      fromStart,
      quoted: placed && bits >= least && said.some(isUncommon),
    };
  }
  if (!top || !top.quoted || top.bits - nextBits < marginBits) {
    return suggest ? suggestedFrom(runs) : null;
  }
  return {
    verse: top.verse,
    run: top.run,
    shared: sharedInOrder(heardWords, top.words),
    bits: top.bits,
    fromStart: top.fromStart,
    covers: top.run / Math.max(1, top.words.length),
    sure: true,
  };
}

/**
 * The verse a few words most likely begin to quote, to suggest in the box:
 * the one whose run says most, by `SUGGEST_MARGIN_BITS` — or, of those that
 * say as much, the best known (`wellKnownRank`). `null` when none says
 * enough, or several do and none of them is well known.
 *
 * `rivals`: the other verses that said as much, for the agent to tell the
 * suggestion from as more words come (`heard-scripture.ts`); `fromEnd`: how
 * many of the words heard, from the newest back, the suggestion was found by.
 */
function suggestedFrom(all) {
  const runs = all.filter((run) => run.now);
  const best = runs.reduce((most, run) => Math.max(most, run.bits), 0);
  const close = runs.filter((run) => run.bits > best - SUGGEST_MARGIN_BITS);
  const suggesting = close.filter((run) => run.suggests);
  if (suggesting.length === 0) return null;
  let chosen = null;
  if (close.length === 1) {
    chosen = suggesting[0];
  } else {
    let bestRank = Infinity;
    for (const run of suggesting) {
      const rank = wellKnownRank(run.verse);
      if (rank !== null && rank < bestRank) {
        chosen = run;
        bestRank = rank;
      }
    }
  }
  if (!chosen) return null;
  return {
    verse: chosen.verse,
    run: chosen.run,
    bits: chosen.bits,
    fromEnd: chosen.fromEnd,
    // Those the words open first: "In the beginning" is in the middle of a
    // dozen verses, and John 1:1 is one it opens.
    rivals: close
      .filter((run) => run !== chosen)
      .sort(
        (left, right) =>
          Number(right.fromStart) - Number(left.fromStart)
          || Number(right.suggests) - Number(left.suggests)
          || right.bits - left.bits,
      )
      .slice(0, SUGGEST_RIVALS)
      .map((run) => run.verse),
    sure: false,
  };
}

/** How many words two texts share in order, gaps allowed. */
function sharedInOrder(a, b) {
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return previous[b.length];
}

/** How many more words another Bible must share with a quote to displace the one in use. */
export const OTHER_BIBLE_BY = 2;

/**
 * Of one quote matched in several Bibles, select the match.
 *
 * Hard invariant: The preferred (active) Bible translation remains active and
 * is NEVER displaced merely because a rival Bible shares more words with a quote.
 */
export function chooseAcrossBibles(matches, preferredId) {
  const preferred = matches.find((match) => match.versionId === preferredId) ?? null;
  const better = (left, right) =>
    !right || left.shared > right.shared || (left.shared === right.shared && left.run > right.run)
      ? left
      : right;
  if (!preferred) {
    return matches.reduce((best, match) => better(match, best), null);
  }
  const rival = matches
    .filter((match) => match !== preferred && match.shared >= preferred.shared + OTHER_BIBLE_BY)
    .reduce((best, match) => better(match, best), null);
  return rival ?? preferred;
}
