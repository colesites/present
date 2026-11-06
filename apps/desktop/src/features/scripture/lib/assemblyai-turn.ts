/**
 * A `Turn` message from AssemblyAI's streaming service, read the way the
 * Bible and song agents want it: every word heard so far, the one still being
 * said included, and whether the turn is done.
 *
 * A message's `transcript` holds only the words the service has finalised;
 * the newest, still forming, are only in `words`. Shown from `transcript`, the
 * text was always a word or more behind the speaker. Measured against a
 * recorded sermon on universal-streaming-english: a word first shows in
 * `words` a median 0.39 s after it is said (worst 0.55 s), and in
 * `transcript` 0.64 s after (worst 1.2 s).
 *
 * With `format_turns` on, each turn ends twice: unformatted ("romans 828"),
 * then formatted ("Romans 8:28."). Only the formatted one is final, so a
 * voice command ("next verse") acts once, and a reference that could be read
 * two ways ("genesis 111") is settled by the formatting.
 */

export interface AssemblyAiTurn {
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  words?: Array<{ text: string; word_is_final?: boolean }>;
}

export interface HeardTurn {
  /** Every word heard so far in the turn, the one still being said included. */
  text: string;
  /** The turn as it will stay. */
  isFinal: boolean;
}

const spoken = (turn: AssemblyAiTurn): string => {
  const words = (turn.words ?? [])
    .map((word) => word.text.trim())
    .filter(Boolean);
  return words.length > 0
    ? words.join(" ")
    : String(turn.transcript ?? "").trim();
};

export function readTurn(turn: AssemblyAiTurn, formatted: boolean): HeardTurn {
  if (formatted) {
    // Partials can come marked formatted too (with key terms, the service
    // formats "3:16" as it is said), so only the end of the turn, formatted,
    // is final. Taking any formatted message as final closed every turn at
    // its first word, and the agent heard nothing after it.
    return turn.end_of_turn && turn.turn_is_formatted
      ? { text: String(turn.transcript ?? "").trim(), isFinal: true }
      : { text: spoken(turn), isFinal: false };
  }
  const utterance = String(turn.utterance ?? "").trim();
  const isFinal = Boolean(turn.end_of_turn) || utterance.length > 0;
  return {
    text: isFinal
      ? utterance || String(turn.transcript ?? "").trim()
      : spoken(turn),
    isFinal,
  };
}
