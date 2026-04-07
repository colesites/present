"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BibleVerse } from "./db";

interface ScripturePanelState {
  lookupValue: string;
  selectedVersionCode: string | null;
  suggestion: string | null;
  liveTranscript: string;
  textSearchQuery: string;
  textSearchResults: BibleVerse[];
  setLookupValue: (lookupValue: string) => void;
  setSelectedVersionCode: (selectedVersionCode: string | null) => void;
  setSuggestion: (suggestion: string | null) => void;
  setLiveTranscript: (liveTranscript: string) => void;
  setTextSearchQuery: (textSearchQuery: string) => void;
  setTextSearchResults: (textSearchResults: BibleVerse[]) => void;
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
> = {
  lookupValue: "",
  selectedVersionCode: null,
  suggestion: null,
  liveTranscript: "",
  textSearchQuery: "",
  textSearchResults: [],
};

const INITIAL_SCRIPTURE_TRANSIENT_STATE: Pick<
  ScripturePanelState,
  "lookupValue" | "suggestion" | "liveTranscript" | "textSearchQuery" | "textSearchResults"
> = {
  lookupValue: "",
  suggestion: null,
  liveTranscript: "",
  textSearchQuery: "",
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
      resetSearchState: () => set(INITIAL_SCRIPTURE_TRANSIENT_STATE),
    }),
    {
      name: "present-scripture-panel-state",
      partialize: (state) => ({
        selectedVersionCode: state.selectedVersionCode,
      }),
    },
  ),
);
