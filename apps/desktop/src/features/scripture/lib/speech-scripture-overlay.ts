"use client";

import { create } from "zustand";
import type { SpeechScriptureCandidate } from "../components/SpeechScriptureStack";

type SpeechScriptureOverlayHandlers = {
  onAccept: (candidate: SpeechScriptureCandidate) => void;
  onDecline: (candidate: SpeechScriptureCandidate) => void;
  onNext: (candidate: SpeechScriptureCandidate) => void;
  onPrevious: (candidate: SpeechScriptureCandidate) => void;
};

type SpeechScriptureOverlayState = {
  activeVersePk: string | null;
  candidates: SpeechScriptureCandidate[];
  handlers: SpeechScriptureOverlayHandlers | null;
  setOverlay: (input: {
    activeVersePk: string | null;
    candidates: SpeechScriptureCandidate[];
    handlers: SpeechScriptureOverlayHandlers;
  }) => void;
  clearOverlay: () => void;
};

export const useSpeechScriptureOverlayStore =
  create<SpeechScriptureOverlayState>()((set) => ({
    activeVersePk: null,
    candidates: [],
    handlers: null,
    setOverlay: ({ activeVersePk, candidates, handlers }) =>
      set({ activeVersePk, candidates, handlers }),
    clearOverlay: () =>
      set({ activeVersePk: null, candidates: [], handlers: null }),
  }));
