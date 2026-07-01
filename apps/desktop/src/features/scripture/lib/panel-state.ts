"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BibleVerse } from "./db";

export type BibleSearchMode = "exact" | "broad";

interface ScripturePanelState {
  lookupValue: string;
  selectedVersionCode: string | null;
  suggestion: string | null;
  liveTranscript: string;
  textSearchQuery: string;
  textSearchResults: BibleVerse[];
  searchMode: BibleSearchMode;
  setLookupValue: (lookupValue: string) => void;
  setSelectedVersionCode: (selectedVersionCode: string | null) => void;
  setSuggestion: (suggestion: string | null) => void;
  setLiveTranscript: (liveTranscript: string) => void;
  setTextSearchQuery: (textSearchQuery: string) => void;
  setTextSearchResults: (textSearchResults: BibleVerse[]) => void;
  setSearchMode: (searchMode: BibleSearchMode) => void;
  resetSearchState: () => void;
}

const INITIAL_SCRIPTURE_PANEL_STATE: Pick<
  ScripturePanelState,
  | "lookupValue"
  | "selectedVersionCode"
  | "suggestion"
  | "liveTranscript"
  | "textSearchQuery"
  | "textSearchResults"
  | "searchMode"
> = {
  lookupValue: "",
  selectedVersionCode: null,
  suggestion: null,
  liveTranscript: "",
  textSearchQuery: "",
  textSearchResults: [],
  searchMode: "broad",
};

const INITIAL_SCRIPTURE_TRANSIENT_STATE: Pick<
  ScripturePanelState,
  "suggestion" | "liveTranscript" | "textSearchResults"
> = {
  suggestion: null,
  liveTranscript: "",
  textSearchResults: [],
};

export const useScripturePanelStore = create<ScripturePanelState>()(
  persist(
    (set) => ({
      ...INITIAL_SCRIPTURE_PANEL_STATE,
      setLookupValue: (lookupValue) => set({ lookupValue }),
      setSelectedVersionCode: (selectedVersionCode) =>
        set({ selectedVersionCode }),
      setSuggestion: (suggestion) => set({ suggestion }),
      setLiveTranscript: (liveTranscript) => set({ liveTranscript }),
      setTextSearchQuery: (textSearchQuery) => set({ textSearchQuery }),
      setTextSearchResults: (textSearchResults) => set({ textSearchResults }),
      setSearchMode: (searchMode) => set({ searchMode }),
      resetSearchState: () => set(INITIAL_SCRIPTURE_TRANSIENT_STATE),
    }),
    {
      name: "present-scripture-panel-state",
      partialize: (state) => ({
        lookupValue: state.lookupValue,
        selectedVersionCode: state.selectedVersionCode,
        textSearchQuery: state.textSearchQuery,
        searchMode: state.searchMode,
      }),
    },
  ),
);
