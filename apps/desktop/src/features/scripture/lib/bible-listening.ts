"use client";

import { create } from "zustand";

interface BibleListeningState {
  /** The Bible agent's microphone is on, or starting. */
  listening: boolean;
  /** Turn it off, from anywhere. Set by the Bible tab while it listens. */
  stop: () => void;
  publish: (listening: boolean, stop?: () => void) => void;
}

const noop = (): void => undefined;

/**
 * Whether the Bible agent is listening, for what is outside the Bible tab:
 * the tab is kept running while it is (`PresentCenterArea`), so that the
 * microphone does not stop when the operator goes to the songs or the media;
 * the footer of the other tabs says so, and can stop it; and the song agent
 * turns it off before it listens itself, since they share the plan's speech
 * time and one microphone is enough.
 */
export const useBibleListeningStore = create<BibleListeningState>()((set) => ({
  listening: false,
  stop: noop,
  publish: (listening, stop) => set({ listening, stop: listening ? (stop ?? noop) : noop }),
}));
