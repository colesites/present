"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LookLayerKey,
  LookTargetKey,
  LookTextPosition,
  LooksConfig,
} from "../../../shared/types/looks";
import { createDefaultLooksConfig, normalizeLooksConfig } from "../../../shared/types/looks";

const LOOKS_STORAGE_KEY = "present-looks-config";

const rustCore = () => import("../../tauri/looks");

/**
 * The output layer flags, as React sees them.
 *
 * Rust owns them (`services/looks.rs`): the current state is read once and
 * every change — including one another window made — arrives as `looks:changed`.
 * What stored copy there is in `localStorage` only seeds the first render.
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
  const [looksConfig, setLooksConfig] = useState<LooksConfig>(() => readLooksConfig());

  // Read the current state once, then let the event carry every change —
  // including changes another window made.
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await rustCore();
      const unlisten = await core.onLooksChanged((config) => {
        if (!cancelled) setLooksConfig(config);
      });
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;

      // After subscribing, not before: a change landing between the two would
      // otherwise be missed.
      const current = await core.getLooksConfig();
      if (!cancelled) setLooksConfig(current);
    })().catch((error: unknown) => {
      console.error("[Looks] could not reach the Rust core", error);
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  /**
   * Apply a change in Rust. The new config arrives back through
   * `looks:changed`, so there is no local `setState` here — one owner.
   */
  const apply = useCallback(
    (toRust: (core: Awaited<ReturnType<typeof rustCore>>) => Promise<unknown>) => {
      void rustCore()
        .then(toRust)
        .catch((error: unknown) => {
          console.error("[Looks] change rejected by the Rust core", error);
        });
    },
    [],
  );

  const setSelectedTarget = useCallback(
    (target: LookTargetKey) => {
      apply((core) => core.setLooksTarget(target));
    },
    [apply],
  );

  const setSelectedLook = useCallback(
    (lookId: string) => {
      apply((core) => core.setSelectedLook(lookId));
    },
    [apply],
  );

  const addLook = useCallback(
    (name?: string) => {
      apply((core) => core.addLook(name));
    },
    [apply],
  );

  const setLookName = useCallback(
    (lookId: string, name: string) => {
      apply((core) => core.setLookName(lookId, name));
    },
    [apply],
  );

  const setLayerEnabledForLook = useCallback(
    (lookId: string, target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      apply((core) => core.setLookLayer(lookId, target, layer, enabled));
    },
    [apply],
  );

  /** Several layers as one change, so a toggle cannot half-apply. */
  const setLayersEnabledForLook = useCallback(
    (lookId: string, target: LookTargetKey, layers: LookLayerKey[], enabled: boolean) => {
      apply((core) => core.setLookLayers(lookId, target, layers, enabled));
    },
    [apply],
  );

  const setLayerEnabled = useCallback(
    (target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      setLayerEnabledForLook(looksConfig.selectedLookId, target, layer, enabled);
    },
    [looksConfig.selectedLookId, setLayerEnabledForLook],
  );

  const setTextPositionForLook = useCallback(
    (lookId: string, target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      apply((core) => core.setLookTextPosition(lookId, target, patch));
    },
    [apply],
  );

  const setTextPosition = useCallback(
    (target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      setTextPositionForLook(looksConfig.selectedLookId, target, patch);
    },
    [looksConfig.selectedLookId, setTextPositionForLook],
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
    setLayersEnabledForLook,
    setTextPosition,
    setTextPositionForLook,
  };
}
