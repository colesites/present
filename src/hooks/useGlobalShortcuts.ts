// src/hooks/useGlobalShortcuts.ts
import { useEffect } from "react";
import type { BottomTab } from "@/types";
import type { ShowsPanelRef } from "@/features/shows";
import type { MediaPanelRef } from "@/features/media";
import type { ScripturePanelRef } from "@/features/scripture";
import type { RefObject } from "react";

type Params = {
  setBottomTab: (tab: BottomTab) => void;
  showsPanelRef: RefObject<ShowsPanelRef | null>;
  mediaPanelRef: RefObject<MediaPanelRef | null>;
  scripturePanelRef: RefObject<ScripturePanelRef | null>;
};

export function useGlobalShortcuts({
  setBottomTab,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
}: Params) {
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;

      // Cmd/Ctrl + K: Shows
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBottomTab("shows");
        requestAnimationFrame(() => {
          showsPanelRef.current?.focusSearch();
        });
        return;
      }

      // Cmd/Ctrl + M: Media
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        setBottomTab("media");
        requestAnimationFrame(() => {
          mediaPanelRef.current?.focusSearch();
        });
        return;
      }

      // Cmd/Ctrl + B: Scripture
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setBottomTab("scripture");
        requestAnimationFrame(() => {
          scripturePanelRef.current?.focusSearch();
        });
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [setBottomTab, showsPanelRef, mediaPanelRef, scripturePanelRef]);
}
