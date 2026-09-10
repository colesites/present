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
 * True inside the Tauri shell. Read from the global Tauri injects before any
 * app code runs, so the choice is settled before the first render.
 */
const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The Rust client, imported only when there is a Rust core to talk to.
 *
 * Dynamic so the Electron bundle never pulls in `@tauri-apps/api` — the same
 * arrangement the AssemblyAI broker uses.
 */
const rustCore = () => import("../../tauri/looks");

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
  const onRust = isTauriShell();

  // Under Tauri the flags live in Rust. Read the current state once, then let
  // the event carry every change — including changes another window made,
  // which is the case `localStorage` cannot report without polling.
  useEffect(() => {
    if (!onRust) {
      return;
    }

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
  }, [onRust]);

  useEffect(() => {
    if (onRust) {
      return;
    }
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
  }, [onRust]);

  useEffect(() => {
    if (onRust) {
      return;
    }
    try {
      const serialized = JSON.stringify(looksConfig);
      window.localStorage.setItem(LOOKS_STORAGE_KEY, serialized);
      lastLooksRawRef.current = serialized;
    } catch {
      void 0;
    }
  }, [looksConfig, onRust]);

  /**
   * Apply a change on whichever side owns the state.
   *
   * Under Rust the new config arrives back through `looks:changed`, so there
   * is no local `setState` here — one owner, one source of truth. Under
   * Electron the reducer runs in React exactly as it always did.
   */
  const apply = useCallback(
    (
      toRust: (core: Awaited<ReturnType<typeof rustCore>>) => Promise<unknown>,
      inReact: (current: LooksConfig) => LooksConfig,
    ) => {
      if (onRust) {
        void rustCore()
          .then(toRust)
          .catch((error: unknown) => {
            console.error("[Looks] change rejected by the Rust core", error);
          });
        return;
      }
      setLooksConfig(inReact);
    },
    [onRust],
  );

  const setSelectedTarget = useCallback(
    (target: LookTargetKey) => {
      apply(
        (core) => core.setLooksTarget(target),
        (current) => withSelectedTarget(current, target),
      );
    },
    [apply],
  );

  const setSelectedLook = useCallback(
    (lookId: string) => {
      apply(
        (core) => core.setSelectedLook(lookId),
        (current) => withSelectedLook(current, lookId),
      );
    },
    [apply],
  );

  const addLook = useCallback(
    (name?: string) => {
      apply(
        (core) => core.addLook(name),
        (current) => withAddedLook(current, name),
      );
    },
    [apply],
  );

  const setLookName = useCallback(
    (lookId: string, name: string) => {
      apply(
        (core) => core.setLookName(lookId, name),
        (current) => withLookName(current, lookId, name),
      );
    },
    [apply],
  );

  const setLayerEnabledForLook = useCallback(
    (lookId: string, target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      apply(
        (core) => core.setLookLayer(lookId, target, layer, enabled),
        (current) => withLayerEnabled(current, lookId, target, layer, enabled),
      );
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
      apply(
        (core) => core.setLookTextPosition(lookId, target, patch),
        (current) => withTextPosition(current, lookId, target, patch),
      );
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
    setTextPosition,
    setTextPositionForLook,
  };
}
