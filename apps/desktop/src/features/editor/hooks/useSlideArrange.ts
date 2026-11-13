import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibrarySlide, SlideElement } from "../../../shared/types";
import {
  alignElements,
  copiesOf,
  deleteElements,
  distributeElements,
  groupElements,
  moveElements,
  pickedElements,
  ungroupElements,
  withGroups,
  type Alignment,
} from "../lib/arrange";
import { useThemesModalStore } from "../../../renderer/shared/store/themesModal";

export type ArrangeAction =
  | { kind: "align"; alignment: Alignment }
  | { kind: "distribute"; axis: "horizontal" | "vertical" }
  | { kind: "group" }
  | { kind: "ungroup" }
  | { kind: "duplicate" }
  | { kind: "delete" }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "selectAll" }
  | { kind: "nudge"; dx: number; dy: number };

/**
 * What was copied, for every editor in this window: pasted on the same
 * slide it steps down and right each time, on another it lands in place.
 */
let clipboard: { elements: SlideElement[]; slideId: string | null; pastes: number } | null = null;

let idCounter = 0;
const freshId = (slideId: string, element: SlideElement) =>
  `${slideId}_${element.type}_${Date.now().toString(36)}_${(idCounter += 1)}`;

const isTyping = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

/**
 * Something in front of the editor takes the keys: the Themes panel, or a
 * dialog. Its ⌘Z, Delete and arrows are its own, not the slide's behind it.
 */
const isCoveredByDialog = () =>
  useThemesModalStore.getState().isOpen ||
  Boolean(
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'),
  );

/**
 * Several objects picked at once, and everything done to them: align,
 * spread out, group, copy and paste, duplicate, delete and nudge, from the
 * inspector and from the keyboard (⌘Z, ⌘⇧Z, ⌘C, ⌘X, ⌘V, ⌘D, ⌘A, ⌘G, ⌘⇧G,
 * Delete, the arrows, Escape). The first object picked is the one the
 * inspector edits.
 */
export function useSlideArrange({
  slide,
  slideId,
  canvas,
  enabled,
  primaryId,
  setPrimary,
  updateElements,
  undo,
  redo,
  slideKeys,
}: {
  slide: LibrarySlide | null;
  slideId: string | null;
  canvas: { width: number; height: number };
  /** The slides view is showing: shortcuts are on. */
  enabled: boolean;
  primaryId: string | null;
  setPrimary: (id: string | null) => void;
  updateElements: (slideId: string | null, updater: (elements: SlideElement[]) => SlideElement[]) => void;
  undo: () => boolean;
  redo: () => boolean;
  /** Keys for the slide list, when it was the last thing pressed: first say. */
  slideKeys?: (event: KeyboardEvent) => boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const elements = useMemo(() => slide?.elements ?? [], [slide?.elements]);

  // The primary object cleared elsewhere (another slide, a removed object)
  // clears the rest; objects gone after an undo leave the selection.
  useEffect(() => {
    setSelectedIds((current) => {
      if (!primaryId) return current.length === 0 ? current : [];
      const existing = new Set(elements.map((element) => element.id));
      const kept = current.filter((id) => existing.has(id));
      if (!kept.includes(primaryId)) return withGroups(elements, [primaryId]);
      return kept.length === current.length ? current : kept;
    });
  }, [elements, primaryId]);

  const selectElements = useCallback(
    (ids: string[], primary: string | null = ids[0] ?? null) => {
      setSelectedIds(ids);
      setPrimary(primary);
    },
    [setPrimary],
  );

  /** One object picked, with its group. */
  const selectElement = useCallback(
    (id: string | null) => selectElements(id ? withGroups(elements, [id]) : [], id),
    [elements, selectElements],
  );

  const run = useCallback(
    (action: ArrangeAction): boolean => {
      if (!slideId) return false;
      const ids = selectedIds;
      switch (action.kind) {
        case "selectAll": {
          const all = elements.filter((element) => !element.isLocked && element.isVisible !== false).map((e) => e.id);
          selectElements(all, all[0] ?? null);
          return all.length > 0;
        }
        case "paste": {
          if (!clipboard || clipboard.elements.length === 0) return false;
          const sameSlide = clipboard.slideId === slideId;
          clipboard.pastes = sameSlide ? clipboard.pastes + 1 : 0;
          const copies = copiesOf(clipboard.elements, sameSlide ? 20 * clipboard.pastes : 0, (element) =>
            freshId(slideId, element),
          );
          clipboard.slideId = slideId;
          updateElements(slideId, (current) => [...current, ...copies]);
          selectElements(copies.map((e) => e.id));
          return true;
        }
        default:
          break;
      }
      if (ids.length === 0) return false;
      switch (action.kind) {
        case "align":
          updateElements(slideId, (current) => alignElements(current, ids, action.alignment, canvas));
          return true;
        case "distribute":
          updateElements(slideId, (current) => distributeElements(current, ids, action.axis));
          return true;
        case "group": {
          const groupId = `${slideId}_group_${Date.now().toString(36)}_${(idCounter += 1)}`;
          updateElements(slideId, (current) => groupElements(current, ids, groupId));
          return true;
        }
        case "ungroup":
          updateElements(slideId, (current) => ungroupElements(current, ids));
          return true;
        case "nudge":
          updateElements(slideId, (current) => moveElements(current, ids, action.dx, action.dy));
          return true;
        case "copy":
        case "cut":
          clipboard = { elements: pickedElements(elements, ids), slideId, pastes: 0 };
          if (action.kind === "cut") {
            updateElements(slideId, (current) => deleteElements(current, ids));
            selectElements([], null);
          }
          return true;
        case "duplicate": {
          const copies = copiesOf(pickedElements(elements, ids), 20, (element) => freshId(slideId, element));
          updateElements(slideId, (current) => [...current, ...copies]);
          selectElements(copies.map((e) => e.id));
          return true;
        }
        case "delete":
          updateElements(slideId, (current) => deleteElements(current, ids));
          selectElements([], null);
          return true;
      }
      return false;
    },
    [canvas, elements, selectElements, selectedIds, slideId, updateElements],
  );

  const runRef = useRef(run);
  runRef.current = run;
  const historyRef = useRef({ undo, redo });
  historyRef.current = { undo, redo };
  const slideKeysRef = useRef(slideKeys);
  slideKeysRef.current = slideKeys;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const selectElementsRef = useRef(selectElements);
  selectElementsRef.current = selectElements;


  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || isCoveredByDialog()) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const handled = (() => {
        if (slideKeysRef.current?.(event)) return true;
        if (mod && key === "z") return event.shiftKey ? historyRef.current.redo() : historyRef.current.undo();
        if (mod && key === "y") return historyRef.current.redo();
        if (mod && key === "c") return runRef.current({ kind: "copy" });
        if (mod && key === "x") return runRef.current({ kind: "cut" });
        if (mod && key === "v") return runRef.current({ kind: "paste" });
        if (mod && key === "d") return runRef.current({ kind: "duplicate" });
        if (mod && key === "a") return runRef.current({ kind: "selectAll" });
        if (mod && key === "g") return runRef.current({ kind: event.shiftKey ? "ungroup" : "group" });
        if (!mod && (event.key === "Delete" || event.key === "Backspace")) return runRef.current({ kind: "delete" });
        if (!mod && event.key.startsWith("Arrow")) {
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          return runRef.current({ kind: "nudge", dx, dy });
        }
        if (event.key === "Escape" && selectedIdsRef.current.length > 0) {
          selectElementsRef.current([], null);
          return true;
        }
        return false;
      })();
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  return { selectedIds, selectElements, selectElement, run, hasClipboard: () => Boolean(clipboard?.elements.length) };
}
