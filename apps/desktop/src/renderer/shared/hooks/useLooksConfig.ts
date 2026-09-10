"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LookLayerKey,
  LookTargetKey,
  LookTextPosition,
  LooksConfig,
} from "../../../shared/types/looks";
import {
  createDefaultLooksConfig,
  normalizeLooksConfig,
  withAddedLook,
  withLayerEnabled,
  withLookName,
  withSelectedLook,
  withSelectedTarget,
  withTextPosition,
} from "../../../shared/types/looks";

const LOOKS_STORAGE_KEY = "present-looks-config";

/**
 * The output layer flags, as React sees them.
 *
 * Every rule this hook applies now lives in `shared/lib/looks-config.mjs`,
 * pinned by `tests/looks-config.test.mjs`. What is left here is the React and
 * storage plumbing: reading the config in, writing it back, and keeping the
 * Looks window and the operator window in step.
 *
 * That last part is the weak point and is why this slice moves to Rust first.
 * Two windows share this state through `localStorage`, and `localStorage` fires
 * no event in the window that wrote it — so the hook **polls every 400 ms**.
 * A layer the operator toggles can take that long to reach the audience screen,
 * and two windows writing in the same tick silently lose one of the writes.
 * Rust-owned state replaces the poll with an event.
 */
const readLooksConfig = (): LooksConfig => {
  if (typeof window === "undefined") {
    return createDefaultLooksConfig();
  }

  try {
    const raw = window.localStorage.getItem(LOOKS_STORAGE_KEY);
    if (!raw) {
      return createDefaultLooksConfig();
    }
    return normalizeLooksConfig(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultLooksConfig();
  }
};

export function useLooksConfig() {
  const lastLooksRawRef = useRef<string | null>(null);
  const [looksConfig, setLooksConfig] = useState<LooksConfig>(() => readLooksConfig());

  useEffect(() => {
    const syncFromStorage = () => {
      const raw = window.localStorage.getItem(LOOKS_STORAGE_KEY);
      if (!raw || raw === lastLooksRawRef.current) {
        return;
      }
      try {
        setLooksConfig(normalizeLooksConfig(JSON.parse(raw) as unknown));
        lastLooksRawRef.current = raw;
      } catch {
        void 0;
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOOKS_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        setLooksConfig(normalizeLooksConfig(JSON.parse(event.newValue) as unknown));
        lastLooksRawRef.current = event.newValue;
      } catch {
        void 0;
      }
    };

    syncFromStorage();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncFromStorage);
    const intervalId = window.setInterval(syncFromStorage, 400);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncFromStorage);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    try {
      const serialized = JSON.stringify(looksConfig);
      window.localStorage.setItem(LOOKS_STORAGE_KEY, serialized);
      lastLooksRawRef.current = serialized;
    } catch {
      void 0;
    }
  }, [looksConfig]);

  const setSelectedTarget = useCallback((target: LookTargetKey) => {
    setLooksConfig((current) => withSelectedTarget(current, target));
  }, []);

  const setSelectedLook = useCallback((lookId: string) => {
    setLooksConfig((current) => withSelectedLook(current, lookId));
  }, []);

  const addLook = useCallback((name?: string) => {
    setLooksConfig((current) => withAddedLook(current, name));
  }, []);

  const setLookName = useCallback((lookId: string, name: string) => {
    setLooksConfig((current) => withLookName(current, lookId, name));
  }, []);

  const setLayerEnabledForLook = useCallback(
    (lookId: string, target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      setLooksConfig((current) => withLayerEnabled(current, lookId, target, layer, enabled));
    },
    [],
  );

  const setLayerEnabled = useCallback(
    (target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      setLooksConfig((current) =>
        withLayerEnabled(current, current.selectedLookId, target, layer, enabled),
      );
    },
    [],
  );

  const setTextPositionForLook = useCallback(
    (lookId: string, target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      setLooksConfig((current) => withTextPosition(current, lookId, target, patch));
    },
    [],
  );

  const setTextPosition = useCallback(
    (target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      setLooksConfig((current) =>
        withTextPosition(current, current.selectedLookId, target, patch),
      );
    },
    [],
  );

  const selectedLook = useMemo(
    () =>
      looksConfig.looks.find((look) => look.id === looksConfig.selectedLookId) ??
      looksConfig.looks[0],
    [looksConfig.looks, looksConfig.selectedLookId],
  );

  const liveLook = useMemo(
    () =>
      looksConfig.looks.find((look) => look.id === looksConfig.liveLookId) ??
      looksConfig.looks[0],
    [looksConfig.liveLookId, looksConfig.looks],
  );

  const activeTargetConfig = useMemo(
    () => selectedLook.targets[looksConfig.selectedTarget],
    [looksConfig.selectedTarget, selectedLook.targets],
  );

  return {
    looksConfig,
    selectedLook,
    liveLook,
    activeTargetConfig,
    setSelectedLook,
    setSelectedTarget,
    addLook,
    setLookName,
    setLayerEnabled,
    setLayerEnabledForLook,
    setTextPosition,
    setTextPositionForLook,
  };
}
