/**
 * Undo and redo for the editor's draft.
 *
 * Each change records the draft as it was before. Changes close together
 * (a drag, a slider, a run of arrow presses) are one step: only the first
 * of them records. A new press or drag starts a new step (`breakStep`).
 *
 * No imports, so the tests can load this file on its own.
 */
export class UndoHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastChangeAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limit = 200,
    private readonly mergeWithinMs = 600,
  ) {}

  /** The draft changed from `previous`. */
  record(previous: T, now: number): void {
    if (now - this.lastChangeAt > this.mergeWithinMs || this.past.length === 0) {
      this.past.push(previous);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastChangeAt = now;
  }

  /** The next change is a step of its own, however soon it comes. */
  breakStep(): void {
    this.lastChangeAt = Number.NEGATIVE_INFINITY;
  }

  /** The draft before the last step, given the one now; null if none. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    this.breakStep();
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.breakStep();
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.breakStep();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
