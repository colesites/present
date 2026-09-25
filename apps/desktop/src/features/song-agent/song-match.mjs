// @ts-check

/**
 * Which song is being sung, and which of its slides the singers are on.
 *
 * Speech recognition of singing is rough: words come out wrong, run
 * together or go missing, and a band repeats a chorus as often as it likes.
 * So nothing here looks for exact lines. It compares the last few words
 * heard with each slide as pairs of neighbouring words ("amazing grace",
 * "grace how"), which survive a wrong word or two on either side, and it
 * weighs a pair by how rare it is across the library, so "the lord" says
 * less about which song this is than "wretch like".
 *
 * Kept apart from React so it can be tested, and so the agent's decisions
 * are the same on every computer.
 */

/**
 * @typedef {{ text: string, label?: string | null }} SongSlideInput
 * @typedef {{ id: string, title: string, slides: SongSlideInput[] }} SongInput
 * @typedef {{
 *   songs: SongInput[],
 *   slidePairs: Set<string>[][],
 *   songPairs: Set<string>[],
 *   postings: Map<string, Array<[number, number]>>,
 *   weights: Map<string, number>,
 * }} SongIndex
 * @typedef {{ songIndex: number, slideIndex: number, hits: number, weight: number, heard: number }} SongCandidate
 */

/**
 * A text as the words the matcher compares: lower case, without section
 * markers ("[Chorus]", "[x2]"), apostrophes ("'twas" is "twas") or
 * punctuation. Letters of any language are kept.
 *
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function wordsOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Each pair of neighbouring words.
 *
 * @param {string[]} words
 * @returns {string[]}
 */
export function pairsOf(words) {
  const pairs = [];
  for (let index = 1; index < words.length; index += 1) {
    pairs.push(`${words[index - 1]} ${words[index]}`);
  }
  return pairs;
}

/**
 * The library, ready to be searched as it is sung.
 *
 * @param {SongInput[]} songs
 * @returns {SongIndex}
 */
export function buildSongIndex(songs) {
  /** @type {Map<string, Array<[number, number]>>} */
  const postings = new Map();
  /** @type {Map<string, number>} */
  const songCounts = new Map();
  const slidePairs = songs.map((song, songIndex) => {
    const inSong = new Set();
    const slides = song.slides.map((slide, slideIndex) => {
      const pairs = new Set(pairsOf(wordsOf(slide.text)));
      for (const pair of pairs) {
        let list = postings.get(pair);
        if (!list) postings.set(pair, (list = []));
        list.push([songIndex, slideIndex]);
        inSong.add(pair);
      }
      return pairs;
    });
    for (const pair of inSong) songCounts.set(pair, (songCounts.get(pair) ?? 0) + 1);
    return slides;
  });
  const songPairs = slidePairs.map((slides) => new Set(slides.flatMap((pairs) => [...pairs])));
  // A pair in every song weighs little; one in a single song weighs most.
  const total = Math.max(1, songs.length);
  /** @type {Map<string, number>} */
  const weights = new Map();
  for (const [pair, count] of songCounts) weights.set(pair, Math.log(1 + total / count));
  return { songs, slidePairs, songPairs, postings, weights };
}

/** How many of the words last heard the search looks at. */
export const SEARCH_WORDS = 16;

/**
 * The songs the words last heard could be, best first, each with the slide
 * that matches them best. `prefer` (song ids, such as the service's) wins a
 * close call.
 *
 * @param {SongIndex} index
 * @param {string[]} words
 * @param {{ prefer?: Set<string> }} [options]
 * @returns {SongCandidate[]}
 */
export function findSongs(index, words, options = {}) {
  const heard = [...new Set(pairsOf(words.slice(-SEARCH_WORDS)))];
  if (heard.length === 0) return [];

  /** @type {Map<number, { hits: number, weight: number, slides: Map<number, number> }>} */
  const bySong = new Map();
  for (const pair of heard) {
    const places = index.postings.get(pair);
    if (!places) continue;
    const weight = index.weights.get(pair) ?? 0;
    const counted = new Set();
    for (const [songIndex, slideIndex] of places) {
      let song = bySong.get(songIndex);
      if (!song) bySong.set(songIndex, (song = { hits: 0, weight: 0, slides: new Map() }));
      if (!counted.has(songIndex)) {
        counted.add(songIndex);
        song.hits += 1;
        song.weight += weight;
      }
      song.slides.set(slideIndex, (song.slides.get(slideIndex) ?? 0) + weight);
    }
  }

  const prefer = options.prefer ?? new Set();
  return [...bySong.entries()]
    .map(([songIndex, song]) => {
      let slideIndex = 0;
      let best = -1;
      for (const [candidate, weight] of song.slides) {
        if (weight > best || (weight === best && candidate < slideIndex)) {
          best = weight;
          slideIndex = candidate;
        }
      }
      const bonus = prefer.has(index.songs[songIndex].id) ? 1.1 : 1;
      return { songIndex, slideIndex, hits: song.hits, weight: song.weight * bonus, heard: heard.length };
    })
    .sort((left, right) => right.weight - left.weight);
}

/**
 * The best candidate, if it is clearly the song: enough of what was heard
 * is in it, and it is well ahead of the next song.
 *
 * @param {SongCandidate[]} candidates
 * @returns {SongCandidate | null}
 */
export function confidentSong(candidates) {
  const [best, second] = candidates;
  if (!best) return null;
  if (best.hits < 4 || best.hits < best.heard * 0.35) return null;
  if (second && second.weight * 1.5 > best.weight) return null;
  return best;
}

/** How many of the latest words decide which slide the singers are on. */
export const FOLLOW_WORDS = 8;

/**
 * Where in one song the latest words are. Later pairs count more than
 * earlier ones: at the turn of a slide the words heard span both, and the
 * new slide is where the singing is going.
 *
 * Slides that match equally (a chorus that comes round again) resolve to
 * the one nearest ahead of `currentIndex`, which is itself when it is one
 * of them.
 *
 * @param {Set<string>[]} slides the song's slides, as `buildSongIndex` pairs them
 * @param {string[]} words
 * @param {number} currentIndex
 * @returns {{ slideIndex: number, hits: number, score: number, currentScore: number } | null}
 */
export function followSong(slides, words, currentIndex) {
  const tail = pairsOf(words.slice(-FOLLOW_WORDS));
  if (tail.length === 0 || slides.length === 0) return null;
  const scores = slides.map((pairs) => {
    let hits = 0;
    let score = 0;
    tail.forEach((pair, position) => {
      if (pairs.has(pair)) {
        hits += 1;
        score += 1 + position / tail.length;
      }
    });
    return { hits, score };
  });
  const top = Math.max(...scores.map((entry) => entry.score));
  if (top <= 0) return null;
  const count = slides.length;
  const from = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  let slideIndex = -1;
  for (let step = 0; step < count; step += 1) {
    const candidate = (from + step) % count;
    if (scores[candidate].score >= top - 1e-9) {
      slideIndex = candidate;
      break;
    }
  }
  return {
    slideIndex,
    hits: scores[slideIndex].hits,
    score: scores[slideIndex].score,
    currentScore: currentIndex >= 0 && currentIndex < count ? scores[currentIndex].score : 0,
  };
}

/**
 * Following one song as it is sung: when to move the slide on.
 *
 * It moves only when the singing is plainly on another slide: two or more
 * of the latest pairs of words are on it, it matches better than the slide
 * showing, and it was the answer last time too, unless it is the very next
 * slide and three pairs match. It waits a moment after each move, and for a few seconds will
 * not go back, because the words heard just after a move still include the
 * end of the slide it left.
 *
 * @param {{ holdMs?: number, backLockMs?: number }} [options]
 */
export function createFollower(options = {}) {
  const holdMs = options.holdMs ?? 1200;
  const backLockMs = options.backLockMs ?? 4000;
  let lastMoveAt = -Infinity;
  let lastMoveTo = -1;
  /** @type {number | null} */
  let pending = null;

  return {
    reset() {
      lastMoveAt = -Infinity;
      lastMoveTo = -1;
      pending = null;
    },
    /**
     * @param {{ slides: Set<string>[], words: string[], currentIndex: number, now: number }} input
     * @returns {number | null} the slide to move to, or null to stay
     */
    step({ slides, words, currentIndex, now }) {
      const found = followSong(slides, words, currentIndex);
      if (!found || found.slideIndex === currentIndex || found.hits < 2 || found.score <= found.currentScore) {
        pending = null;
        return null;
      }
      if (now - lastMoveAt < holdMs) return null;
      if (found.slideIndex < currentIndex && lastMoveTo === currentIndex && now - lastMoveAt < backLockMs) {
        return null;
      }
      const isNext = found.slideIndex === currentIndex + 1;
      const agreed = pending === found.slideIndex;
      pending = found.slideIndex;
      if (!(agreed || (isNext && found.hits >= 3))) return null;
      pending = null;
      lastMoveAt = now;
      lastMoveTo = found.slideIndex;
      return found.slideIndex;
    },
  };
}

/**
 * Words heard so far, as the agent keeps them: every finished turn, and the
 * one still being spoken, which speech recognition keeps revising. Only the
 * last `limit` words are kept.
 *
 * @param {number} [limit]
 */
export function createHeardWords(limit = 48) {
  /** @type {string[]} */
  let committed = [];
  /** @type {string[]} */
  let current = [];
  let lastFinal = "";
  return {
    /** @param {string} transcript @param {boolean} isFinal */
    hear(transcript, isFinal) {
      const words = wordsOf(transcript);
      if (!isFinal) {
        current = words;
        return;
      }
      current = [];
      // A turn can be sent final twice: plain, then with punctuation.
      const key = words.join(" ");
      if (!key || key === lastFinal) return;
      lastFinal = key;
      committed = [...committed, ...words].slice(-limit);
    },
    /** @returns {string[]} */
    words() {
      return [...committed, ...current].slice(-limit);
    },
    clear() {
      committed = [];
      current = [];
      lastFinal = "";
    },
  };
}
