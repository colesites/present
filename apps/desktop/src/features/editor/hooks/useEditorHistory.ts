import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { UndoHistory } from "../lib/history";

/**
 * Undo and redo for the editor's draft: every change to it is recorded,
 * whoever made it, and changes close together are one step. Opening
 * another item starts a new history. A press anywhere starts a new step,
 * so two drags in a row undo one at a time.
 */
export function useEditorHistory<T extends { _id?: unknown }>(draft: T, setDraft: Dispatch<SetStateAction<T>>) {
  const historyRef = useRef(new UndoHistory<T>());
  const previousRef = useRef(draft);
  const restoringRef = useRef(false);
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  const publish = useCallback(() => {
    const history = historyRef.current;
    setState((current) =>
      current.canUndo === history.canUndo && current.canRedo === history.canRedo
        ? current
        : { canUndo: history.canUndo, canRedo: history.canRedo },
    );
  }, []);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = draft;
    if (previous === draft) return;
    if (restoringRef.current) {
      restoringRef.current = false;
    } else if (String(previous._id) !== String(draft._id)) {
      historyRef.current.clear();
    } else {
      historyRef.current.record(previous, performance.now());
    }
    publish();
  }, [draft, publish]);

  useEffect(() => {
    const breakStep = () => historyRef.current.breakStep();
    window.addEventListener("pointerdown", breakStep, true);
    return () => window.removeEventListener("pointerdown", breakStep, true);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.undo(previousRef.current);
    if (previous === null) return false;
    restoringRef.current = true;
    setDraft(previous);
    publish();
    return true;
  }, [publish, setDraft]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(previousRef.current);
    if (next === null) return false;
    restoringRef.current = true;
    setDraft(next);
    publish();
    return true;
  }, [publish, setDraft]);

  return { undo, redo, canUndo: state.canUndo, canRedo: state.canRedo };
}
