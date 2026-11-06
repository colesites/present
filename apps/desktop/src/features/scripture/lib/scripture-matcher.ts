/**
 * Fast, reliable, local Bible matching engine.
 *
 * Evaluates spoken words against the active Bible translation:
 * - Pre-computed inverted index with IDF (Inverse Document Frequency) weights
 * - Distinctive token weighting (common words don't trigger false positives)
 * - Sequence alignment (ordered tokens with gap penalties)
 * - Speech-to-text error and archaic-form tolerance (unto/to, hath/has, etc.)
 * - Continuity bias for consecutive verses relative to the active passage
 * - Ambiguity margin guard: abstains if top candidates compete closely
 * - Sliding window matching over rolling transcript buffers spanning pauses
 *
 * Hard invariant: NEVER switches translations based on match score.
 */

import type { BibleVerse } from "./db";
import type { HeardWord } from "./transcript-buffer";

export interface MatcherConfig {
  /** Minimum number of matched meaningful tokens required. Default: 3. */
  minMatchedTokens: number;
  /** Minimum number of distinctive tokens (IDF > threshold) required. Default: 2. */
  minDistinctiveTokens: number;
  /** Minimum total score required to accept a match. Default: 45. */
  minScore: number;
  /**
   * Ambiguity margin: (topScore - secondScore) / topScore must be >= this,
   * unless top candidate has sequential continuity. Default: 0.15.
   */
  ambiguityMargin: number;
  /** Bonus added for the immediately following verse in the active chapter. Default: 35. */
  continuityBonus: number;
  /** Bonus for adjacent verses (+- 2 verses) in the active chapter. Default: 15. */
  adjacentBonus: number;
  /** Minimum IDF score for a token to be considered distinctive. Default: 1.2. */
  distinctiveIdfThreshold: number;
  /** Enable Levenshtein fuzzy matching on distinctive tokens. Default: true. */
  fuzzyMatching: boolean;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  minMatchedTokens: 3,
  minDistinctiveTokens: 2,
  minScore: 45,
  ambiguityMargin: 0.15,
  continuityBonus: 35,
  adjacentBonus: 15,
  distinctiveIdfThreshold: 1.2,
  fuzzyMatching: true,
};

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't",
  "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
  "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's",
  "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll",
  "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
  "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of",
  "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
  "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should",
  "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their",
  "theirs", "them", "themselves", "then", "there", "there's", "these", "they",
  "they'd", "they'll", "they're", "they've", "this", "those", "through", "to",
  "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll",
  "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with",
  "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've",
  "your", "yours", "yourself", "yourselves",
]);

/** Common phonetic and archaic word equivalences in Bible speech. */
const WORD_EQUIVALENCES = new Map<string, string>([
  ["unto", "to"],
  ["saith", "said"],
  ["sayeth", "said"],
  ["says", "said"],
  ["thy", "your"],
  ["thee", "you"],
  ["thine", "yours"],
  ["thou", "you"],
  ["ye", "you"],
  ["hath", "has"],
  ["doth", "does"],
  ["heavens", "heaven"],
  ["spake", "spoke"],
]);

export function normalizeToken(token: string): string {
  const norm = token
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return WORD_EQUIVALENCES.get(norm) ?? norm;
}

export function tokenizeText(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

export type IndexedVerse = {
  verse: BibleVerse;
  tokens: string[];
  tokenSet: Set<string>;
  length: number;
};

export type BibleMatcherIndex = {
  versionId: string;
  verses: IndexedVerse[];
  /** Token -> array of indices in `verses` */
  postings: Map<string, number[]>;
  /** Token -> IDF score */
  tokenIDF: Map<string, number>;
  totalVerses: number;
};

/** Compute Levenshtein distance for fuzzy matching. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.max(a.length, b.length);

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

/**
 * Build the inverted index and precalculate IDF weights for one Bible version.
 */
export function buildBibleMatcherIndex(verses: BibleVerse[]): BibleMatcherIndex {
  const totalVerses = verses.length;
  const indexedVerses: IndexedVerse[] = new Array(totalVerses);
  const postings = new Map<string, number[]>();

  for (let i = 0; i < totalVerses; i += 1) {
    const verse = verses[i]!;
    const tokens = tokenizeText(verse.text);
    const tokenSet = new Set(tokens);
    indexedVerses[i] = {
      verse,
      tokens,
      tokenSet,
      length: tokens.length,
    };

    for (const token of tokenSet) {
      const list = postings.get(token);
      if (list) {
        list.push(i);
      } else {
        postings.set(token, [i]);
      }
    }
  }

  // Calculate smoothed IDF: ln(1 + (N - df + 0.5) / (df + 0.5))
  const tokenIDF = new Map<string, number>();
  for (const [token, list] of postings.entries()) {
    const df = list.length;
    if (STOP_WORDS.has(token) || (totalVerses >= 10 && df >= totalVerses * 0.15)) {
      tokenIDF.set(token, 0.2);
    } else {
      const idf = Math.log(1 + (Math.max(totalVerses, 10) - df + 0.5) / (df + 0.5));
      tokenIDF.set(token, Math.max(0.2, idf));
    }
  }

  return {
    versionId: verses[0]?.version ?? "unknown",
    verses: indexedVerses,
    postings,
    tokenIDF,
    totalVerses,
  };
}

export type SpokenMatch = {
  verse: BibleVerse;
  score: number;
  confidence: number;
  matchedTokens: number;
  distinctiveTokens: number;
  continuity: boolean;
  margin: number;
};

/**
 * Score one candidate verse against spoken tokens.
 */
function scoreCandidate(
  candidate: IndexedVerse,
  spokenTokens: string[],
  spokenDistinctive: string[],
  index: BibleMatcherIndex,
  config: MatcherConfig,
  activePassage?: { bookId: string; chapter: number; verse?: number | null } | null,
): { score: number; matchedTokens: number; distinctiveTokens: number; continuity: boolean } {
  let score = 0;
  let matchedTokens = 0;
  let distinctiveTokens = 0;

  // Track positions of matches in the verse to reward in-order alignment and runs
  let lastVersePos = -1;
  let currentRun = 0;
  let currentRunHasDistinctive = false;
  let longestRun = 0;
  let longestDistinctiveRun = 0;
  let outOfOrderPenalty = 0;

  for (const spoken of spokenTokens) {
    let versePos = -1;
    const isDistinctive = (index.tokenIDF.get(spoken) ?? 0) >= config.distinctiveIdfThreshold && !STOP_WORDS.has(spoken);

    // 1. Exact match in verse tokens
    for (let pos = 0; pos < candidate.tokens.length; pos += 1) {
      if (candidate.tokens[pos] === spoken && pos > lastVersePos) {
        versePos = pos;
        break;
      }
    }

    // 2. If not found after lastVersePos, check anywhere in verse
    if (versePos === -1 && candidate.tokenSet.has(spoken)) {
      versePos = candidate.tokens.indexOf(spoken);
    }

    // 3. Fuzzy match for distinctive tokens
    if (versePos === -1 && config.fuzzyMatching && spoken.length >= 5) {
      for (let pos = 0; pos < candidate.tokens.length; pos += 1) {
        const vToken = candidate.tokens[pos]!;
        if (Math.abs(vToken.length - spoken.length) <= 1 && levenshteinDistance(spoken, vToken) <= 1) {
          versePos = pos;
          break;
        }
      }
    }

    if (versePos >= 0) {
      matchedTokens += 1;
      const idf = index.tokenIDF.get(spoken) ?? 1.0;
      score += idf * 8;

      if (isDistinctive) {
        distinctiveTokens += 1;
        score += 10;
      }

      if (versePos > lastVersePos) {
        // Monotonic in-order progression
        const gap = versePos - lastVersePos;
        if (gap === 1) {
          currentRun += 1;
          if (isDistinctive) currentRunHasDistinctive = true;
          if (currentRun > longestRun) longestRun = currentRun;
          if (currentRunHasDistinctive && currentRun > longestDistinctiveRun) {
            longestDistinctiveRun = currentRun;
          }
          score += currentRun * 6; // Exact contiguous run bonus
        } else {
          currentRun = 1;
          currentRunHasDistinctive = isDistinctive;
          score += Math.max(0, 5 - Math.min(gap, 5)); // Mild gap decay
        }
        lastVersePos = versePos;
      } else {
        // Out of order match
        outOfOrderPenalty += 4;
        currentRun = 1;
        currentRunHasDistinctive = isDistinctive;
      }
    } else {
      currentRun = 0;
      currentRunHasDistinctive = false;
    }
  }

  score -= outOfOrderPenalty;

  // Bonus for matching a significant percentage of the verse
  const coverage = matchedTokens / Math.max(1, candidate.length);
  score += Math.round(coverage * 25);

  // Bonus for long exact runs
  if (longestRun >= 4) {
    score += longestRun * 10;
  }

  // Active passage continuity bonus
  let continuity = false;
  if (activePassage && candidate.verse.bookId === activePassage.bookId) {
    if (candidate.verse.chapter === activePassage.chapter) {
      const activeVerse = activePassage.verse ?? 1;
      if (candidate.verse.verse === activeVerse + 1) {
        // Immediately following verse: strong sequential bonus
        score += config.continuityBonus;
        continuity = true;
      } else if (Math.abs(candidate.verse.verse - activeVerse) <= 2) {
        // Adjacent verse
        score += config.adjacentBonus;
      } else {
        // Same chapter
        score += 5;
      }
    }
  }

  // A genuine quotation must have a contiguous run of at least 3 words containing
  // a distinctive word, or a run of at least 4 words, or high verse coverage (>50%),
  // or active sequential continuity.
  const isGenuineQuote =
    longestDistinctiveRun >= 3 ||
    longestRun >= 4 ||
    coverage >= 0.5 ||
    continuity;

  if (!isGenuineQuote) {
    score = 0;
  }

  return {
    score: Math.max(0, score),
    matchedTokens,
    distinctiveTokens,
    continuity,
  };
}

/**
 * Match a sequence of spoken words against the Bible index.
 */
export function matchSpokenScripture(
  index: BibleMatcherIndex,
  spokenInput: string | HeardWord[],
  options: {
    activePassage?: { bookId: string; chapter: number; verse?: number | null } | null;
    config?: Partial<MatcherConfig>;
  } = {},
): SpokenMatch | null {
  const config = { ...DEFAULT_MATCHER_CONFIG, ...options.config };
  const spokenTokens =
    typeof spokenInput === "string"
      ? tokenizeText(spokenInput)
      : spokenInput.map((w) => normalizeToken(w.text)).filter(Boolean);

  if (spokenTokens.length < 2) return null;

  // Identify distinctive spoken tokens (IDF >= distinctiveIdfThreshold)
  const distinctiveTokens: string[] = [];
  for (const token of spokenTokens) {
    const idf = index.tokenIDF.get(token) ?? 0;
    if (idf >= config.distinctiveIdfThreshold && !STOP_WORDS.has(token)) {
      distinctiveTokens.push(token);
    }
  }

  // Fast candidate retrieval
  const candidateCounts = new Map<number, number>();
  for (const token of distinctiveTokens) {
    const list = index.postings.get(token);
    if (!list) continue;
    for (const entryIdx of list) {
      candidateCounts.set(entryIdx, (candidateCounts.get(entryIdx) ?? 0) + 1);
    }
  }

  // Also include the immediately following verse from active passage as a candidate
  if (options.activePassage) {
    const { bookId, chapter, verse } = options.activePassage;
    const nextVerseNum = (verse ?? 1) + 1;
    for (let i = 0; i < index.verses.length; i += 1) {
      const v = index.verses[i]!.verse;
      if (v.bookId === bookId && v.chapter === chapter && v.verse === nextVerseNum) {
        candidateCounts.set(i, Math.max(candidateCounts.get(i) ?? 0, 1));
        break;
      }
    }
  }

  if (candidateCounts.size === 0) return null;

  const scored: Array<{
    candidate: IndexedVerse;
    score: number;
    matchedTokens: number;
    distinctiveTokens: number;
    continuity: boolean;
  }> = [];

  for (const [entryIdx, count] of candidateCounts.entries()) {
    // Must share at least minDistinctiveTokens, or 1 if it's the active next verse
    if (count < config.minDistinctiveTokens && count < distinctiveTokens.length) {
      const cand = index.verses[entryIdx]!;
      const isNextVerse =
        options.activePassage &&
        cand.verse.bookId === options.activePassage.bookId &&
        cand.verse.chapter === options.activePassage.chapter &&
        cand.verse.verse === (options.activePassage.verse ?? 1) + 1;
      if (!isNextVerse) continue;
    }

    const candidate = index.verses[entryIdx]!;
    const res = scoreCandidate(
      candidate,
      spokenTokens,
      distinctiveTokens,
      index,
      config,
      options.activePassage,
    );

    if (
      res.score >= config.minScore &&
      res.matchedTokens >= config.minMatchedTokens &&
      (res.distinctiveTokens >= config.minDistinctiveTokens || res.continuity)
    ) {
      scored.push({
        candidate,
        ...res,
      });
    }
  }

  if (scored.length === 0) return null;

  // Rank candidates descending by score
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  const second = scored[1];

  let margin = 1.0;
  if (second) {
    margin = (top.score - second.score) / top.score;
    // Ambiguity check: if competitor is too close and top has no continuity prior, abstain!
    if (margin < config.ambiguityMargin && !top.continuity) {
      return null;
    }
  }

  const confidence = Math.min(1.0, Math.max(0.5, top.score / 120));

  return {
    verse: top.candidate.verse,
    score: top.score,
    confidence,
    matchedTokens: top.matchedTokens,
    distinctiveTokens: top.distinctiveTokens,
    continuity: top.continuity,
    margin,
  };
}

/**
 * Matches sliding windows across the rolling transcript words (e.g. windows
 * of 8, 16, 24, 32 words) spanning turn boundaries.
 */
export function matchRollingTranscript(
  index: BibleMatcherIndex,
  recentWords: HeardWord[],
  options: {
    activePassage?: { bookId: string; chapter: number; verse?: number | null } | null;
    config?: Partial<MatcherConfig>;
  } = {},
): SpokenMatch | null {
  if (recentWords.length < 2) return null;

  // Test windows: newest 10 words, 20 words, 35 words, 50 words
  const windowSizes = [10, 20, 35, 50];
  let bestMatch: SpokenMatch | null = null;

  for (const size of windowSizes) {
    const windowWords = recentWords.slice(Math.max(0, recentWords.length - size));
    const match = matchSpokenScripture(index, windowWords, options);
    if (match) {
      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}
