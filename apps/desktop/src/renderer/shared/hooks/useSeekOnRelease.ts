"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";

/**
 * A position slider that moves only its thumb while it is dragged, and seeks
 * once, where it is let go.
 *
 * A seek on every step of a drag sent dozens a second: each one flushed the
 * sound and made every picture of the video find a new place, so the sound
 * stuttered and the pictures froze while the operator was still choosing
 * where to go. And the position kept arriving from Rust meanwhile, pulling
 * the thumb back under the pointer. Spread the result on the `<input
 * type="range">`; arrow keys seek when the key is released.
 */
export function useSeekOnRelease(position: number, seek: (seconds: number) => void) {
  const [draft, setDraft] = useState<number | null>(null);
  // Read on release, which can come before the render the last change asked for.
  const draftRef = useRef<number | null>(null);

  const commit = useCallback(() => {
    const target = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (target !== null && Number.isFinite(target)) seek(target);
  }, [seek]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    draftRef.current = next;
    setDraft(next);
  }, []);

  return {
    value: draft ?? position,
    onChange,
    onPointerUp: commit,
    onKeyUp: commit,
    onBlur: commit,
  };
}
