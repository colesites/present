import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 420;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export function useSpacebarToggle(
  onToggle: () => void,
  options: {
    onPressStart?: () => void;
    onPressEnd?: () => void;
  } = {},
) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const onPressStartRef = useRef(options.onPressStart);
  const onPressEndRef = useRef(options.onPressEnd);

  useEffect(() => {
    onPressStartRef.current = options.onPressStart;
    onPressEndRef.current = options.onPressEnd;
  }, [options.onPressEnd, options.onPressStart]);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      firedRef.current = false;
      onPressEndRef.current?.();
    };

    const isSpacebar = (event: KeyboardEvent) =>
      event.code === "Space" || event.key === " " || event.key === "Spacebar";

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpacebar(event) || event.repeat || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (timerRef.current != null) {
        return;
      }

      onPressStartRef.current?.();
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        onToggle();
      }, LONG_PRESS_MS);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpacebar(event)) return;
      event.preventDefault();
      clear();
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", clear);

    return () => {
      clear();
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", clear);
    };
  }, [onToggle]);
}
