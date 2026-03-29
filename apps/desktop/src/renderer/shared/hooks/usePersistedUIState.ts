"use client";

import { useEffect, useState } from "react";
import type { BottomTab, ViewMode } from "../../../shared/types";

type PersistedState = {
  viewMode: ViewMode;
  bottomTab: BottomTab;
};

const STORAGE_KEY = "present-ui-state";

type PersistedOptions = {
  restoreStored?: boolean;
};

export function usePersistedUIState(
  defaults?: Partial<PersistedState>,
  options?: PersistedOptions,
) {
  const defaultViewMode = defaults?.viewMode ?? "show";
  const defaultBottomTab = defaults?.bottomTab ?? "media";
  const restoreStored = options?.restoreStored ?? true;

  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [bottomTab, setBottomTab] = useState<BottomTab>(defaultBottomTab);
  const [isHydrated, setIsHydrated] = useState(false);

  // Restore persisted UI state after hydration
  useEffect(() => {
    if (!restoreStored) {
      setViewMode(defaultViewMode);
      setBottomTab(defaultBottomTab);
      setIsHydrated(true);
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored) as Partial<PersistedState>;
        if (state.viewMode) setViewMode(state.viewMode);
        if (state.bottomTab) setBottomTab(state.bottomTab);
      }
    } catch (e) {
      console.error("Failed to load UI state:", e);
    } finally {
      setIsHydrated(true);
    }
  }, [defaultBottomTab, defaultViewMode, restoreStored]);

  // Persist view state (only after hydration)
  useEffect(() => {
    if (!isHydrated) return;

    const state: PersistedState = { viewMode, bottomTab };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to persist UI state:", e);
    }
  }, [isHydrated, viewMode, bottomTab]);

  return { viewMode, setViewMode, bottomTab, setBottomTab, isHydrated };
}
