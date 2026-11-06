/**
 * What the preacher has said, word by word, across pauses.
 *
 * AssemblyAI's v3 stream (`useSpeechRecognition`) sends a `Turn` message again
 * and again for the same turn (`turn_order`), each one the *whole* turn so far,
 * re-transcribed: Universal-3 Pro may rewrite earlier words, not only add new
 * ones. A turn ends (`end_of_turn`) after a short silence, which is not the end
 * of a thought: "In the beginning" … pause … "God created the heaven and the
 * earth" arrives as two turns.
 *
 * This keeps one ordered list of words for the listening session:
 *
 * - a snapshot of a turn **replaces** the earlier snapshot of the same turn —
 *   it is never appended, so repeated snapshots cannot duplicate words;
 * - words are **stable** once the service says so (`word_is_final`), once two
 *   snapshots in a row agree on them (when the service gives no flag), or when
 *   the turn ends; the rest of the turn is **tentative**;
 * - the words of finished turns stay, so a pause does not erase context, and
 *   are pruned only by age and count (`TranscriptRetention`);
 * - every word has an absolute position in the session (`pos`), which never
 *   goes backwards and is what decisions are tied to;
 * - snapshots of a turn already finished, of an older turn, or of another
 *   session are ignored, so delayed, duplicated or reordered messages cannot
 *   change what was heard.
 *
 * React-free, so it can be tested with transcript sequences.
 */

export type TranscriptWordInput = {
  text: string;
  /** Milliseconds into the audio stream. */
  start?: number | null;
  end?: number | null;
  /** 0 to 1. */
  confidence?: number | null;
  /** `word_is_final`: locked in, will not change in later snapshots. */
  final?: boolean | null;
};

export type TranscriptEvent = {
  /** The listening session; bumps on every start, reconnect or reset. */
  session: number;
  /** `turn_order`: which turn this is a snapshot of. */
  turn: number;
  /** The whole turn so far. */
  transcript: string;
  words?: TranscriptWordInput[] | null;
  endOfTurn: boolean;
  /** When it arrived, on the clock the agent uses (`performance.now()`). */
  receivedAt?: number;
};

export type HeardWord = {
  /** Absolute position in the session; never reused for another stable word. */
  pos: number;
  text: string;
  /** Lower case, without punctuation, for comparing. */
  norm: string;
  turn: number;
  start: number | null;
  end: number | null;
  confidence: number | null;
  receivedAt: number;
};

export type TranscriptUpdate = {
  /** Why nothing changed, when nothing did. */
  ignored: null | "stale-session" | "stale-turn" | "duplicate" | "empty";
  /** Bumps whenever stable words are added or revised. */
  stableRevision: number;
  /** Stable words added by this event, oldest first. */
  added: HeardWord[];
  /**
   * The position from which stable words were rewritten by this event, or
   * `null`. Only possible when stability was inferred by agreement, never for
   * words the service marked final.
   */
  revisedFrom: number | null;
  /** The position after the newest stable word. */
  stableEnd: number;
  /** The rest of the current turn, not yet stable. */
  tentative: HeardWord[];
  /** This event ended its turn. */
  turnEnded: boolean;
};

export type TranscriptRetention = {
  /** Most stable words kept. */
  maxWords: number;
  /** Stable words older than this (by arrival) are pruned, ms. */
  maxAgeMs: number;
  /** Never prune below this many words, whatever their age. */
  minWords: number;
};

export const DEFAULT_RETENTION: TranscriptRetention = {
  maxWords: 600,
  maxAgeMs: 180_000,
  minWords: 60,
};

export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

type SnapshotWord = { text: string; norm: string; input: TranscriptWordInput | null };
type Snapshot = SnapshotWord[];

const snapshotOf = (event: TranscriptEvent): Snapshot => {
  const words = event.words?.filter((word) => word && typeof word.text === "string") ?? [];
  if (words.length > 0) {
    return words
      .map((word): SnapshotWord => ({ text: word.text.trim(), norm: normalizeWord(word.text), input: word }))
      .filter((word) => word.norm.length > 0);
  }
  return event.transcript
    .split(/\s+/)
    .map((text): SnapshotWord => ({ text, norm: normalizeWord(text), input: null }))
    .filter((word) => word.norm.length > 0);
};

export function createTranscriptBuffer(retention: TranscriptRetention = DEFAULT_RETENTION) {
  let session = -1;
  /** Stable words, oldest first (finished turns and the current turn's stable prefix). */
  let stable: HeardWord[] = [];
  let nextPos = 0;
  let stableRevision = 0;
  /** The turn being heard, and how many of its words are in `stable`. */
  let turn = -1;
  let turnClosed = true;
  let turnCommitted = 0;
  let previousSnapshot: Snapshot = [];
  let tentative: HeardWord[] = [];
  let lastKey = "";

  const reset = (nextSession: number) => {
    session = nextSession;
    stable = [];
    nextPos = 0;
    stableRevision += 1;
    turn = -1;
    turnClosed = true;
    turnCommitted = 0;
    previousSnapshot = [];
    tentative = [];
    lastKey = "";
  };

  const prune = (now: number) => {
    const excess = stable.length - retention.maxWords;
    let drop = Math.max(0, excess);
    while (
      drop < stable.length - retention.minWords
      && now - (stable[drop]?.receivedAt ?? now) > retention.maxAgeMs
    ) {
      drop += 1;
    }
    // The current turn's stable words stay: they may still be revised.
    const currentTurnStart = stable.length - (turnClosed ? 0 : turnCommitted);
    drop = Math.min(drop, currentTurnStart);
    if (drop > 0) stable = stable.slice(drop);
  };

  const word = (
    entry: Snapshot[number],
    pos: number,
    turnOrder: number,
    receivedAt: number,
  ): HeardWord => ({
    pos,
    text: entry.text,
    norm: entry.norm,
    turn: turnOrder,
    start: typeof entry.input?.start === "number" ? entry.input.start : null,
    end: typeof entry.input?.end === "number" ? entry.input.end : null,
    confidence: typeof entry.input?.confidence === "number" ? entry.input.confidence : null,
    receivedAt,
  });

  const unchanged = (turnEnded = false): TranscriptUpdate => ({
    ignored: null,
    stableRevision,
    added: [],
    revisedFrom: null,
    stableEnd: nextPos,
    tentative,
    turnEnded,
  });

  const ignore = (why: NonNullable<TranscriptUpdate["ignored"]>): TranscriptUpdate => ({
    ...unchanged(),
    ignored: why,
  });

  /** Commit the current turn's remaining words as stable, as it closes. */
  const closeTurn = (receivedAt: number): HeardWord[] => {
    const added: HeardWord[] = [];
    for (let index = turnCommitted; index < previousSnapshot.length; index += 1) {
      const entry = previousSnapshot[index];
      if (!entry) continue;
      const heard = word(entry, nextPos, turn, receivedAt);
      nextPos += 1;
      stable.push(heard);
      added.push(heard);
    }
    turnCommitted = previousSnapshot.length;
    turnClosed = true;
    tentative = [];
    if (added.length > 0) stableRevision += 1;
    return added;
  };

  const ingest = (event: TranscriptEvent): TranscriptUpdate => {
    const receivedAt = event.receivedAt ?? Date.now();
    if (event.session !== session) {
      if (event.session < session) return ignore("stale-session");
      reset(event.session);
    }
    if (event.turn < turn || (event.turn === turn && turnClosed)) {
      return ignore("stale-turn");
    }
    const key = `${event.turn}|${event.endOfTurn ? 1 : 0}|${event.transcript}|${event.words?.map((w) => `${w.text}${w.final ? "!" : ""}`).join(" ") ?? ""}`;
    if (key === lastKey) return ignore("duplicate");
    lastKey = key;

    const added: HeardWord[] = [];
    if (event.turn > turn) {
      // A newer turn: whatever the last one said stands, even if its
      // `end_of_turn` never came (or comes late, and is then ignored).
      if (!turnClosed) added.push(...closeTurn(receivedAt));
      turn = event.turn;
      turnClosed = false;
      turnCommitted = 0;
      previousSnapshot = [];
    }

    const snapshot = snapshotOf(event);
    if (snapshot.length === 0 && !event.endOfTurn) {
      return added.length > 0 ? { ...unchanged(), added } : ignore("empty");
    }

    // How much of this turn is stable now.
    let stableCount: number;
    if (event.endOfTurn) {
      stableCount = snapshot.length;
    } else if (snapshot.some((entry) => typeof entry.input?.final === "boolean")) {
      stableCount = 0;
      while (stableCount < snapshot.length && snapshot[stableCount]?.input?.final === true) {
        stableCount += 1;
      }
    } else {
      // No flags: a word is stable once two snapshots in a row agree on it
      // and it is not the newest word, which may still be growing.
      let agreed = 0;
      while (
        agreed < snapshot.length
        && agreed < previousSnapshot.length
        && snapshot[agreed]?.norm === previousSnapshot[agreed]?.norm
      ) {
        agreed += 1;
      }
      stableCount = Math.min(agreed, snapshot.length - 1);
    }

    // Words already committed for this turn that this snapshot rewrites.
    let revisedFrom: number | null = null;
    let keep = 0;
    while (
      keep < turnCommitted
      && keep < snapshot.length
      && stable[stable.length - turnCommitted + keep]?.norm === snapshot[keep]?.norm
    ) {
      keep += 1;
    }
    if (keep < turnCommitted) {
      const firstRevised = stable[stable.length - turnCommitted + keep];
      revisedFrom = firstRevised?.pos ?? nextPos;
      stable = stable.slice(0, stable.length - (turnCommitted - keep));
      nextPos = revisedFrom;
      turnCommitted = keep;
      stableRevision += 1;
    }

    for (let index = turnCommitted; index < Math.max(stableCount, turnCommitted); index += 1) {
      const entry = snapshot[index];
      if (!entry) break;
      const heard = word(entry, nextPos, event.turn, receivedAt);
      nextPos += 1;
      stable.push(heard);
      added.push(heard);
    }
    turnCommitted = Math.max(stableCount, turnCommitted);
    if (added.length > 0) stableRevision += 1;
    previousSnapshot = snapshot;

    let tentativePos = nextPos;
    tentative = snapshot
      .slice(turnCommitted)
      .map((entry) => word(entry, tentativePos++, event.turn, receivedAt));

    if (event.endOfTurn) {
      turnClosed = true;
      tentative = [];
    }
    prune(receivedAt);
    return {
      ignored: null,
      stableRevision,
      added,
      revisedFrom,
      stableEnd: nextPos,
      tentative,
      turnEnded: event.endOfTurn,
    };
  };

  return {
    ingest,
    reset,
    get session() {
      return session;
    },
    get stableEnd() {
      return nextPos;
    },
    get stableRevision() {
      return stableRevision;
    },
    /** The newest `count` stable words, oldest first. */
    recent(count: number): HeardWord[] {
      return stable.slice(Math.max(0, stable.length - count));
    },
    /** Stable words from `pos` on. */
    since(pos: number): HeardWord[] {
      const first = stable.findIndex((heard) => heard.pos >= pos);
      return first < 0 ? [] : stable.slice(first);
    },
    tentative(): HeardWord[] {
      return tentative;
    },
    size(): number {
      return stable.length;
    },
  };
}

export type TranscriptBuffer = ReturnType<typeof createTranscriptBuffer>;

export const textOf = (words: { text: string }[]): string =>
  words.map((heard) => heard.text).join(" ");
