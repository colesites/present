"use client";

import { useEffect, useState } from "react";
import { IDENTIFY_EVENT } from "../../tauri/screens";

/**
 * Shown on a screen for a moment when Screen Configuration's Identify asks:
 * the screen's name and size, or the name of the output it is on. The core
 * sends each window its own words (`commands/screens.rs`), so which TV is
 * which can be seen from the desk instead of guessed.
 */
const SHOWN_FOR_MS = 3_000;

type Identify = { title: string; detail: string };

export function ScreenIdentify() {
  const [shown, setShown] = useState<Identify | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    let hideId: number | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<Identify>(IDENTIFY_EVENT, ({ payload }) => {
          if (!payload || typeof payload.title !== "string") return;
          setShown(payload);
          window.clearTimeout(hideId);
          hideId = window.setTimeout(() => setShown(null), SHOWN_FOR_MS);
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
        <div className="mt-[1vmin] text-[10vmin] font-semibold leading-none tracking-tight">{shown.title}</div>
        {shown.detail ? (
          <div className="mt-[2vmin] text-[3vmin] tabular-nums text-white/70">{shown.detail}</div>
        ) : null}
      </div>
    </div>
  );
}
