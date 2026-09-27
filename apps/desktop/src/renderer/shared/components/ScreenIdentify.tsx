"use client";

import { useEffect, useState } from "react";

/**
 * Sent by Screens & sound's Identify button to every window: each screen that
 * is on shows its name for a moment, so which TV is which can be seen from
 * the desk instead of guessed.
 */
export const IDENTIFY_EVENT = "screens:identify";

const SHOWN_FOR_MS = 3_000;

export function ScreenIdentify({ name }: { name: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    let hideId: number | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen(IDENTIFY_EVENT, () => {
          setShown(true);
          window.clearTimeout(hideId);
          hideId = window.setTimeout(() => setShown(false), SHOWN_FOR_MS);
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);

    return () => {
      cancelled = true;
      window.clearTimeout(hideId);
      detach?.();
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483000] flex items-center justify-center">
      <div className="rounded-[3vmin] border-[0.5vmin] border-white/90 bg-black/80 px-[7vmin] py-[4.5vmin] text-center text-white shadow-2xl backdrop-blur-sm">
        <div className="text-[3vmin] font-medium uppercase tracking-[0.2em] text-white/60">Present</div>
        <div className="mt-[1vmin] text-[10vmin] font-semibold leading-none tracking-tight">{name}</div>
        <div className="mt-[2vmin] text-[3vmin] tabular-nums text-white/70">
          {Math.round(window.screen.width * window.devicePixelRatio)} ×{" "}
          {Math.round(window.screen.height * window.devicePixelRatio)}
        </div>
      </div>
    </div>
  );
}
