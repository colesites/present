"use client";

import { create } from "zustand";

interface SpeechUsageState {
  activeSessionStartedAtMs: number | null;
  pendingCommittedUsageSeconds: number;
  setActiveSessionStartedAtMs: (value: number | null) => void;
  setPendingCommittedUsageSeconds: (value: number) => void;
}

export const useSpeechUsageStore = create<SpeechUsageState>()((set) => ({
  activeSessionStartedAtMs: null,
  pendingCommittedUsageSeconds: 0,
  setActiveSessionStartedAtMs: (value) =>
    set({ activeSessionStartedAtMs: value }),
  setPendingCommittedUsageSeconds: (value) =>
    set({ pendingCommittedUsageSeconds: Math.max(0, Math.round(value)) }),
}));
