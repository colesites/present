"use client";

import { Mic } from "lucide-react";
import { useBibleListeningStore } from "../lib/bible-listening";

/**
 * The Bible agent, seen from the other tabs: it goes on listening when the
 * operator leaves the Bible tab, and this is where they see that it is, and
 * can stop it without going back.
 */
export function BibleListeningControl() {
  const listening = useBibleListeningStore((state) => state.listening);
  const stop = useBibleListeningStore((state) => state.stop);
  if (!listening) return null;
  return (
    <button
      type="button"
      onClick={stop}
      aria-pressed
      title="Bible agent: listening. Click to stop."
      className="inline-flex h-7 flex-none items-center gap-1.5 rounded-md bg-red-500/15 px-2 text-[11px] font-medium text-foreground ring-1 ring-red-400/50 transition hover:bg-red-500/25"
    >
      <Mic className="h-3.5 w-3.5 animate-pulse text-red-400" />
      Bible agent
    </button>
  );
}
