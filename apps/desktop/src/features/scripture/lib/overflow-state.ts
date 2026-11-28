"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_SCRIPTURE_OVERFLOW,
  normalizeScriptureOverflow,
  type ScriptureOverflow,
} from "./overflow";

interface ScriptureOverflowState {
  overflow: ScriptureOverflow;
  setOverflow: (change: Partial<ScriptureOverflow>) => void;
}

const STORAGE_KEY = "present-scripture-overflow";

/**
 * Told to every window when one changes "Long verses": it is set in Settings
 * and in Bible edit, and the operator window splits the verses up now.
 */
const CHANGED_EVENT = "present:scripture-overflow-changed";

const same = (a: ScriptureOverflow, b: ScriptureOverflow) => JSON.stringify(a) === JSON.stringify(b);

/** What becomes of a long verse (Settings, Slides; Bible edit), kept between launches. */
export const useScriptureOverflowStore = create<ScriptureOverflowState>()(
  persist<ScriptureOverflowState>(
    (set, get) => ({
      overflow: DEFAULT_SCRIPTURE_OVERFLOW,
      setOverflow: (change) => {
        const overflow = normalizeScriptureOverflow({ ...get().overflow, ...change });
        if (same(overflow, get().overflow)) return;
        set({ overflow });
        void import("@tauri-apps/api/event")
          .then(({ emit }) => emit(CHANGED_EVENT, overflow))
          .catch((): void => undefined);
      },
    }),
    {
      name: STORAGE_KEY,
      merge: (stored, current) => ({
        ...current,
        overflow: normalizeScriptureOverflow((stored as Partial<ScriptureOverflowState> | undefined)?.overflow),
      }),
    },
  ),
);

/** A change made in another window, taken as it is: not told on again. */
const arrived = (value: unknown) => {
  const overflow = normalizeScriptureOverflow(value);
  if (!same(overflow, useScriptureOverflowStore.getState().overflow)) {
    useScriptureOverflowStore.setState({ overflow });
  }
};

if (typeof window !== "undefined") {
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<ScriptureOverflow>(CHANGED_EVENT, (event) => arrived(event.payload)))
    .catch((): void => undefined);
  // Outside the desktop app, and as well: another window's save.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      arrived((JSON.parse(event.newValue) as { state?: { overflow?: unknown } }).state?.overflow);
    } catch {
      void 0;
    }
  });
}
