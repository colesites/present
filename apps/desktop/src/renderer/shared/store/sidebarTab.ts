"use client";

import { create } from "zustand";
import type { SidebarTab } from "../../../shared/types";

const STORAGE_KEY = "present-sidebar-tab-v2";
const LEGACY_STORAGE_KEY = "present-sidebar-tab-v1";
const DEFAULT_TAB: SidebarTab = "masters";

const readPersistedTab = (): SidebarTab => {
  if (typeof window === "undefined") return DEFAULT_TAB;
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // One-time migration from v1 (where the [M] tab was misnamed "media").
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        raw = legacy === "media" ? "masters" : legacy;
        window.localStorage.setItem(STORAGE_KEY, raw);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (
      raw === "audio" ||
      raw === "text" ||
      raw === "timer" ||
      raw === "messages" ||
      raw === "layers" ||
      raw === "masters"
    ) {
      return raw;
    }
  } catch {
    // Storage unavailable (private browsing, sandboxing) — fall through.
  }
  return DEFAULT_TAB;
};

interface SidebarTabState {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
}

export const useSidebarTabStore = create<SidebarTabState>()((set) => ({
  activeTab: readPersistedTab(),
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, tab);
      } catch {
        // Best-effort persistence; ignore quota / permission errors.
      }
    }
  },
}));
