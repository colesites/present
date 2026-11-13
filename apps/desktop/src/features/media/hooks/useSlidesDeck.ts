"use client";

import { useEffect, useState } from "react";

import { userMessage } from "../../../renderer/shared/lib/user-error";
import {
  getLoadedDeck,
  prepareMediaSlides,
  useMediaSlidesVersion,
} from "../lib/media-slides";
import type { SlidesItem } from "./useMediaFolders";

/** What came back for one document, as it was when asked. */
type Prepared = { key: string; deckId: string | null; error: string | null };

/**
 * The slides of a PowerPoint or PDF in the Media panel, converted the first
 * time they are wanted — `enabled` once the card is in view — and read from
 * the kept copy after that.
 */
export function useSlidesDeck(item: SlidesItem | null, enabled: boolean) {
  useMediaSlidesVersion();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const path = item?.path ?? null;
  const name = item?.name ?? "";
  const lastModified = item?.lastModified ?? 0;
  const key = path ? `${path}\u0000${lastModified}` : null;

  useEffect(() => {
    if (!path || !key || !enabled) return;
    let cancelled = false;
    prepareMediaSlides({ name, path, lastModified })
      .then(({ deckId }) => {
        if (!cancelled) setPrepared({ key, deckId, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPrepared({
          key,
          deckId: null,
          error: userMessage(error, "These slides couldn't be prepared.", "Media"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key, path, name, lastModified, enabled]);

  // An answer for another document, or an older copy of this one, is none.
  const current = prepared && prepared.key === key ? prepared : null;
  return {
    deckId: current?.deckId ?? null,
    error: current?.error ?? null,
    preparing: Boolean(key && enabled && !current),
    deck: current?.deckId ? getLoadedDeck(current.deckId) : null,
  };
}
