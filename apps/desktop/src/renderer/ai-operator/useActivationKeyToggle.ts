import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 420;
const TOGGLE_DEBOUNCE_MS = 700;

function isActivationChord(event: KeyboardEvent) {
  return (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    event.code === "Space"
  );
}

function isActivationKeyRelease(event: KeyboardEvent) {
  return (
    event.code === "Space" ||
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Option"
  );
}

export function useActivationKeyToggle(
  onToggle: () => void,
  options: {
    onPressStart?: () => void;
    onPressEnd?: () => void;
  } = {},
) {
  const timerRef = useRef<number | null>(null);
  const lastToggleAtRef = useRef(0);
  const onToggleRef = useRef(onToggle);
  const onPressStartRef = useRef(options.onPressStart);
  const onPressEndRef = useRef(options.onPressEnd);

  useEffect(() => {
    onToggleRef.current = onToggle;
    onPressStartRef.current = options.onPressStart;
    onPressEndRef.current = options.onPressEnd;
  }, [onToggle, options.onPressEnd, options.onPressStart]);

  useEffect(() => {
    const requestToggle = () => {
      const now = Date.now();
      if (now - lastToggleAtRef.current < TOGGLE_DEBOUNCE_MS) {
        return;
      }
      lastToggleAtRef.current = now;
      onToggleRef.current();
    };

    const clear = () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      onPressEndRef.current?.();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isActivationChord(event) || event.repeat) {
        return;
      }

      event.preventDefault();

      if (timerRef.current != null) {
        return;
      }

      onPressStartRef.current?.();
      timerRef.current = window.setTimeout(() => {
        requestToggle();
      }, LONG_PRESS_MS);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (timerRef.current == null || !isActivationKeyRelease(event)) {
        return;
      }
      event.preventDefault();
      clear();
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", clear);
    const unsubscribeShortcut =
      window.electronAPI?.onAiOperatorToggleShortcut?.(requestToggle);

    return () => {
      clear();
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", clear);
      unsubscribeShortcut?.();
    };
  }, []);
}
