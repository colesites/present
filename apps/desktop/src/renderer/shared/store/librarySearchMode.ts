"use client";

import { create } from "zustand";

export type LibrarySearchMode = "exact" | "broad";

const STORAGE_KEY = "present-library-search-mode-v1";
const DEFAULT_MODE: LibrarySearchMode = "exact";

const readPersistedMode = (): LibrarySearchMode => {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "exact" || raw === "broad") {
      return raw;
    }
  } catch {
    // Storage unavailable (private browsing, sandboxing) — fall through.
  }
  return DEFAULT_MODE;
};

interface LibrarySearchModeState {
  searchMode: LibrarySearchMode;
  setSearchMode: (mode: LibrarySearchMode) => void;
}

export const useLibrarySearchModeStore = create<LibrarySearchModeState>()(
  (set) => ({
    searchMode: readPersistedMode(),
    setSearchMode: (mode) => {
      set({ searchMode: mode });
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, mode);
        } catch {
          // Best-effort persistence; ignore quota / permission errors.
        }
      }
    },
  })
);
