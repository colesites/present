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

/** Where each sentence begins, as word positions in `wordsOf(normalize(text))`. */
function sentenceStarts(text) {
  const starts = new Set([0]);
  let count = 0;
  for (const sentence of text.split(/[.!?;:]+(?=\s|$)/)) {
    starts.add(count);
    count += wordsOf(normalizeVerseSearchText(sentence)).length;
  }
  return starts;
}

/**
 * The one verse a sentence quotes, word for word, or `null`.
 *
 * For the listening agent's Find it, which reads what was heard without a
 * model: "Jesus wept" said aloud is John 11:35 though no reference was named.
 * A verse counts as quoted when the sentence has all of it, for a verse of up
 * to `QUOTE_MIN_RUN` words, or that many of its words in a row, and those
 * words include one the Bible does not use everywhere: "in the name of Jesus"
 * is in a verse, but it is a way of speaking, not a quote. A quote more than
 * one verse has equally ("his mercy endureth for ever", "in the beginning")
 * finds none of them rather than a guess: the model is asked about those
 * (`lib/heard-scripture.ts`), and knows which a famous one means.
 *
 * `commonAfter`: a word in more verses than this is too common to count;
 * by default 2% of the Bible, and never fewer than 50 verses.
 *
 * `endingWithin`: only a quote that ends this many words or fewer before
 * the end of what was heard — one being read now, not one read a moment ago
 * that the preacher has since moved on from.
 */
export function findQuotedVerse(index, heard, options = {}) {
  return quotedVerseMatch(index, heard, options)?.verse ?? null;
}

/**
 * `findQuotedVerse`, with how many words in a row the quote shares with the
 * verse (`run`) and how many in order, gaps allowed (`shared`) — so the same
 * quote can be weighed across Bibles (`chooseAcrossBibles`).
 */
export function quotedVerseMatch(index, heard, { commonAfter, endingWithin } = {}) {
  const heardWords = wordsOf(normalizeVerseSearchText(heard));
  if (heardWords.length < 2) return null;
  const begins = sentenceStarts(heard);

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

  let best = null;
  let bestRun = 0;
  let bestWords = [];
  let tied = false;
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
    // Turned away below anyway; this only does it before the long part. The
    // phrase is looked for in the verse's text as it is: most candidates go
    // here, every one of them, at every word heard, in every Bible installed.
    if (endingWithin !== undefined && !endsWithPhraseOf(heardWords, text, needed, endingWithin)) {
      continue;
    }
    const verseWords = wordsOf(text);
    const run = longestSharedRun(heardWords, verseWords);
    if (run.length < needed) continue;
    if (
      run.length < Math.min(verseWords.length, QUOTE_ANYWHERE_RUN)
      && !begins.has(run.end - run.length)
      && run.endInB !== run.length
    ) {
      continue;
    }
    if (endingWithin !== undefined && heardWords.length - run.end > endingWithin) continue;
    if (!heardWords.slice(run.end - run.length, run.end).some(isUncommon)) continue;
    if (run.length > bestRun) {
      best = entry.verse;
      bestRun = run.length;
      bestWords = verseWords;
      tied = false;
    } else if (run.length === bestRun) {
      tied = true;
    }
  }
  return tied || !best
    ? null
    : { verse: best, run: bestRun, shared: sharedInOrder(heardWords, bestWords) };
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
