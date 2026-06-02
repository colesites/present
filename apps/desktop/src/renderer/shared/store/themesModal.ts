"use client";

import { create } from "zustand";
import type { SlideElementStyle } from "../../../shared/types";

export interface PendingThemeApplication {
  style: SlideElementStyle;
  backgroundColor: string | null;
  // Bumped on every dispatch so subscribers can detect a new request even if
  // the payload is structurally identical to a previous one.
  nonce: number;
}

interface ThemesModalState {
  isOpen: boolean;
  pending: PendingThemeApplication | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  dispatchApply: (payload: {
    style: SlideElementStyle;
    backgroundColor: string | null;
  }) => void;
  consumePending: () => void;
}

// Global state for the Themes modal:
//   `isOpen`  — the modal toggle, owned outside the editor so any UI can open
//               it (AppHeader button, future palette command, slide menu).
//   `pending` — a one-shot apply request. The Editor watches this and, when
//               a slide is selected, patches its text elements with the
//               theme's style, then calls `consumePending` to clear.
export const useThemesModalStore = create<ThemesModalState>()((set) => ({
  isOpen: false,
  pending: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  dispatchApply: ({ style, backgroundColor }) =>
    set((state) => ({
      pending: {
        style,
        backgroundColor,
        nonce: (state.pending?.nonce ?? 0) + 1,
      },
    })),
  consumePending: () => set({ pending: null }),
}));
