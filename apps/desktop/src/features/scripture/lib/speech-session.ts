/**
 * Whether listening carries on by itself when a speech session ends.
 *
 * A session is opened for fifteen minutes of the plan's speech time at most
 * (`billing.startSpeechUsageSession`), and AssemblyAI ends it when they are
 * up; a connection also drops now and then. Neither is the operator stopping
 * it, and in the middle of a sermon nobody is there to click the microphone
 * again. It used to go quiet at fifteen minutes and stay quiet.
 *
 * React-free, so it can be tested.
 */

/**
 * How long a session must have run for its ending to be one to carry on
 * from. One that ends sooner than this could not really start, and starting
 * it again would only fail again.
 */
export const CARRY_ON_AFTER_MS = 20_000;

/** How many times in a row listening is started again before the operator is told. */
export const MOST_RESTARTS = 3;

export function carriesOn(ended: {
  /** The session that ended is the one that was listening. */
  ours: boolean;
  /** The operator turned the microphone off. */
  stopping: boolean;
  ranForMs: number;
  /** Sessions started again in a row, none of which ran long enough. */
  restarts: number;
}): boolean {
  return (
    ended.ours
    && !ended.stopping
    && ended.ranForMs >= CARRY_ON_AFTER_MS
    && ended.restarts < MOST_RESTARTS
  );
}
