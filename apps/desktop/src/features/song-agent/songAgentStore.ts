"use client";

import { create } from "zustand";

/** A song the agent heard that isn't the one on screen. */
export interface SongAgentSuggestion {
  songId: string;
  title: string;
  /** The section it heard ("Verse 2"), when the slide has a label. */
  label: string | null;
  slideIndex: number;
}

export type SongAgentStatus = "off" | "starting" | "listening";

interface SongAgentState {
  /** The operator has it on. It listens while this is true. */
  enabled: boolean;
  status: SongAgentStatus;
  error: string | null;
  /** The song on screen that it is following, and where. */
  following: { title: string; label: string | null } | null;
  suggestion: SongAgentSuggestion | null;
  setEnabled: (enabled: boolean) => void;
  publish: (
    patch: Partial<Pick<SongAgentState, "status" | "error" | "following" | "suggestion">>,
  ) => void;
  /** Put the suggested song on screen. Set by the agent while it runs. */
  accept: () => void;
  dismiss: () => void;
  setActions: (actions: { accept: () => void; dismiss: () => void } | null) => void;
}

const noop = (): void => undefined;

// The song agent's state, between the agent (in Show view, beside the live
// slide) and its control in the footer, which don't share a parent that
// could hold it without threading it through both.
export const useSongAgentStore = create<SongAgentState>()((set) => ({
  enabled: false,
  status: "off",
  error: null,
  following: null,
  suggestion: null,
  setEnabled: (enabled) =>
    set(enabled ? { enabled, error: null } : { enabled, following: null, suggestion: null }),
  publish: (patch) => set(patch),
  accept: noop,
  dismiss: noop,
  setActions: (actions) => set(actions ?? { accept: noop, dismiss: noop }),
}));
