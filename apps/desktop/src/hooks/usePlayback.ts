"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";

const PLAYBACK_STORAGE_KEY = "present-playback-local";

// Load local playback state from localStorage
function loadLocalPlayback() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(PLAYBACK_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Save local playback state to localStorage
function saveLocalPlayback(state: { activeSlideId: string | null }) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save playback state:", e);
  }
}

export function usePlayback(orgId: Id<"organizations"> | null) {
  // Use plain Convex query - no caching to avoid data conflicts
  const playback = useQuery(
    api.playback.getByOrg,
    orgId ? { orgId } : "skip",
  );
  const setActiveSlide = useMutation(api.playback.setActiveSlide);
  const setFontStyle = useMutation(api.playback.setFontStyle);

  // Local state for offline/instant updates (initialized from localStorage)
  const [localActiveSlideId, setLocalActiveSlideId] = useState<string | null>(
    () => loadLocalPlayback()?.activeSlideId || null,
  );

  // Track if we've made local changes that haven't synced yet
  const hasLocalChanges = useRef(false);
  // Only sync server state to local if we haven't made local changes
  // This prevents the "slide through" effect when coming online
  // Sync server state to local storage if we haven't made local changes.
  // We don't set localActiveSlideId here to avoid cascading renders; 
  // the fallback logic in the return statement handles displaying the server value.
  useEffect(() => {
    // If we have local changes, don't overwrite with server state
    if (hasLocalChanges.current) return;

    // Only update if server has a value and we don't have a local value
    if (playback?.activeSlideId && !localActiveSlideId) {
      saveLocalPlayback({ activeSlideId: playback.activeSlideId });
    }
  }, [playback?.activeSlideId, localActiveSlideId]);

  // No longer need a BroadcastChannel — IPC is used via useOutputBroadcast

  const selectSlide = useCallback(
    async (
      slideId: string,
      slideText?: string,
      slideFooter?: string,
      options?: { suppressBroadcast?: boolean },
    ) => {
      if (!orgId) return;

      // Mark that we have local changes (prevents server overwrite)
      hasLocalChanges.current = true;

      // Update local state immediately
      setLocalActiveSlideId(slideId);
      saveLocalPlayback({ activeSlideId: slideId });

      // Broadcast for instant local update via IPC
      if (!options?.suppressBroadcast && window.electronAPI) {
        window.electronAPI.sendToOutput({
          type: "active-slide",
          slideId,
          slideText,
          slideFooter,
        });
      }

      // Try to persist to database (will fail if offline, that's ok)
      try {
        await setActiveSlide({ orgId, activeSlideId: slideId });
      } catch (e) {
        // Offline or network error - local state is already updated
        console.log("Failed to sync slide to server (offline?):", e);
      }
    },
    [orgId, setActiveSlide],
  );

  const updateFontStyle = useCallback(
    async (styles: {
      fontFamily?: string;
      fontSize?: number;
      fontBold?: boolean;
      fontItalic?: boolean;
      fontUnderline?: boolean;
    }) => {
      if (!orgId) return;
      try {
        await setFontStyle({ orgId, ...styles });
      } catch (e) {
        console.log("Failed to sync font style to server (offline?):", e);
      }
    },
    [orgId, setFontStyle],
  );

  // Use local state, fallback to server state
  const activeSlideId = localActiveSlideId ?? playback?.activeSlideId ?? null;

  return {
    playback,
    activeSlideId,
    fontFamily: playback?.fontFamily ?? "Inter",
    fontSize: playback?.fontSize ?? 72,
    fontBold: playback?.fontBold ?? false,
    fontItalic: playback?.fontItalic ?? false,
    fontUnderline: playback?.fontUnderline ?? false,
    selectSlide,
    updateFontStyle,
  };
}
