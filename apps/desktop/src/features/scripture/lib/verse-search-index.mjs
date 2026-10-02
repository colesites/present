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

export function buildVerseSearchIndex(verses) {
  const entries = verses.map((verse) => ({
    normalizedText: normalizeVerseSearchText(verse.text),
    verse,
  }));
  const postings = new Map();
  entries.forEach((entry, index) => {
    for (const token of tokenize(entry.normalizedText, true)) {
      const list = postings.get(token);
      if (list) list.push(index);
      else postings.set(token, [index]);
    }
  });
  return { entries, postings };
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

/** The fewest words in a row that make a quote of a verse longer than this. */
export const QUOTE_MIN_RUN = 5;

/** A word in more than this share of verses is too common to look a quote up by. */
const COMMON_SHARE = 0.02;

const wordsOf = (normalized) => normalized.split(" ").filter(Boolean);

/**
 * The longest run of words two texts share, in order and unbroken: its length,
 * and where it ends in `a`.
 */
function longestSharedRun(a, b) {
  let best = { length: 0, end: 0 };
  const run = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = run[j];
      run[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (run[j] > best.length) best = { length: run[j], end: i };
      diagonal = above;
    }
  }
  return best;
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
 * one verse has equally ("his mercy endureth for ever") finds none of them
 * rather than a guess.
 *
 * `commonAfter`: a word in more verses than this is too common to count;
 * by default 2% of the Bible, and never fewer than 50 verses.
 */
export function findQuotedVerse(index, heard, { commonAfter } = {}) {
  const heardWords = wordsOf(normalizeVerseSearchText(heard));
  if (heardWords.length < 2) return null;

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
  let tied = false;
  for (const entryIndex of candidates) {
    const entry = index.entries[entryIndex];
    const verseWords = wordsOf(entry.normalizedText);
    const needed = Math.max(2, Math.min(verseWords.length, QUOTE_MIN_RUN));
    const run = longestSharedRun(heardWords, verseWords);
    if (run.length < needed) continue;
    if (!heardWords.slice(run.end - run.length, run.end).some(isUncommon)) continue;
    if (run.length > bestRun) {
      best = entry.verse;
      bestRun = run.length;
      tied = false;
    } else if (run.length === bestRun) {
      tied = true;
    }
  }
  return tied ? null : best;
}
