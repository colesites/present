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
