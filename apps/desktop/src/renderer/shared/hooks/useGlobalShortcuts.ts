// src/hooks/useGlobalShortcuts.ts
import { useEffect } from "react";
import type { BottomTab } from "../../../shared/types";
import type { LibrariesPanelRef } from "../../../features/shows";
import type { MediaPanelRef } from "../../../features/media";
import type { ScripturePanelRef } from "../../../features/scripture";
import type { RefObject } from "react";

type Params = {
  enabled?: boolean;
  setBottomTab: (tab: BottomTab) => void;
  showsPanelRef: RefObject<LibrariesPanelRef | null>;
  mediaPanelRef: RefObject<MediaPanelRef | null>;
  scripturePanelRef: RefObject<ScripturePanelRef | null>;
  showTextInOutput: boolean;
  setShowTextInOutput: (show: boolean) => void;
};

// Don't fire global shortcuts while the user is typing — otherwise Cmd+T
// would also fire from inside the lyrics editor / inputs and look like a bug.
const isTypingInEditableField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return (
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
};

export function useGlobalShortcuts({
  enabled = true,
  setBottomTab,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
  showTextInOutput,
  setShowTextInOutput,
}: Params) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;

      // Cmd/Ctrl + T: toggle the live text layer on the audience output.
      // Works from anywhere except editable fields (so typing "t" inside the
      // editor doesn't fight the operator).
      if (e.key.toLowerCase() === "t" && !e.shiftKey && !e.altKey) {
        if (isTypingInEditableField(e.target)) return;
        e.preventDefault();
        setShowTextInOutput(!showTextInOutput);
        return;
      }

      // Cmd/Ctrl + L: Libraries
      if (e.key.toLowerCase() === "l") {
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
  }, [
    enabled,
    setBottomTab,
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
    showTextInOutput,
    setShowTextInOutput,
  ]);
}
