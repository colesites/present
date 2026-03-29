"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";

const PLAYBACK_STORAGE_KEY = "present-playback-local";
const DEFAULT_FONT_STYLE = {
  fontFamily: "Inter",
  fontSize: 72,
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
};

// Load local playback state from localStorage
function loadLocalPlayback() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(PLAYBACK_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (!parsed) {
      return { activeSlideId: null, ...DEFAULT_FONT_STYLE };
    }
    return {
      activeSlideId: parsed.activeSlideId ?? null,
      fontFamily: parsed.fontFamily ?? DEFAULT_FONT_STYLE.fontFamily,
      fontSize: parsed.fontSize ?? DEFAULT_FONT_STYLE.fontSize,
      fontBold: parsed.fontBold ?? DEFAULT_FONT_STYLE.fontBold,
      fontItalic: parsed.fontItalic ?? DEFAULT_FONT_STYLE.fontItalic,
      fontUnderline: parsed.fontUnderline ?? DEFAULT_FONT_STYLE.fontUnderline,
    };
  } catch {
    return { activeSlideId: null, ...DEFAULT_FONT_STYLE };
  }
}

// Save local playback state to localStorage
function saveLocalPlayback(state: {
  activeSlideId: string | null;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
}) {
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
  const initialLocalPlayback = loadLocalPlayback() ?? {
    activeSlideId: null,
    ...DEFAULT_FONT_STYLE,
  };

  // Local state for offline/instant updates (initialized from localStorage)
  const [localActiveSlideId, setLocalActiveSlideId] = useState<string | null>(
    () => initialLocalPlayback.activeSlideId,
  );
  const [localFontStyle, setLocalFontStyle] = useState(() => ({
    fontFamily: initialLocalPlayback.fontFamily,
    fontSize: initialLocalPlayback.fontSize,
    fontBold: initialLocalPlayback.fontBold,
    fontItalic: initialLocalPlayback.fontItalic,
    fontUnderline: initialLocalPlayback.fontUnderline,
  }));
  const hasLocalFontChanges = useRef(false);

  const persistLocalPlayback = useCallback(
    (nextActiveSlideId: string | null, nextFontStyle: typeof DEFAULT_FONT_STYLE) => {
      saveLocalPlayback({
        activeSlideId: nextActiveSlideId,
        fontFamily: nextFontStyle.fontFamily,
        fontSize: nextFontStyle.fontSize,
        fontBold: nextFontStyle.fontBold,
        fontItalic: nextFontStyle.fontItalic,
        fontUnderline: nextFontStyle.fontUnderline,
      });
    },
    [],
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
      persistLocalPlayback(playback.activeSlideId, localFontStyle);
    }
  }, [playback?.activeSlideId, localActiveSlideId, persistLocalPlayback, localFontStyle]);

  // No longer need a BroadcastChannel — IPC is used via useOutputBroadcast

  const selectSlide = useCallback(
    async (
      slideId: string,
      slideText?: string,
      slideFooter?: string,
      options?: { suppressBroadcast?: boolean },
    ) => {
      // Mark that we have local changes (prevents server overwrite)
      hasLocalChanges.current = true;

      // Update local state immediately
      setLocalActiveSlideId(slideId);
      persistLocalPlayback(slideId, localFontStyle);

      // Broadcast for instant local update via IPC
      if (!options?.suppressBroadcast && window.electronAPI) {
        window.electronAPI.sendToOutput({
          type: "active-slide",
          slideId,
          slideText,
          slideFooter,
        });
      }

      if (!orgId) {
        return;
      }

      // Try to persist to database (will fail if offline, that's ok)
      try {
        await setActiveSlide({ orgId, activeSlideId: slideId });
      } catch (e) {
        // Offline or network error - local state is already updated
        console.log("Failed to sync slide to server (offline?):", e);
      }
    },
    [orgId, setActiveSlide, persistLocalPlayback, localFontStyle],
  );

  const updateFontStyle = useCallback(
    async (styles: {
      fontFamily?: string;
      fontSize?: number;
      fontBold?: boolean;
      fontItalic?: boolean;
      fontUnderline?: boolean;
    }) => {
      hasLocalFontChanges.current = true;
      const nextFontStyle = {
        fontFamily: styles.fontFamily ?? localFontStyle.fontFamily,
        fontSize: styles.fontSize ?? localFontStyle.fontSize,
        fontBold: styles.fontBold ?? localFontStyle.fontBold,
        fontItalic: styles.fontItalic ?? localFontStyle.fontItalic,
        fontUnderline: styles.fontUnderline ?? localFontStyle.fontUnderline,
      };
      setLocalFontStyle(nextFontStyle);
      persistLocalPlayback(localActiveSlideId, nextFontStyle);
      if (!orgId) {
        return;
      }
      try {
        await setFontStyle({ orgId, ...styles });
        hasLocalFontChanges.current = false;
      } catch (e) {
        console.log("Failed to sync font style to server (offline?):", e);
      }
    },
    [orgId, setFontStyle, localFontStyle, localActiveSlideId, persistLocalPlayback],
  );

  // Use local state, fallback to server state
  const activeSlideId = localActiveSlideId ?? playback?.activeSlideId ?? null;

  return {
    playback,
    activeSlideId,
    fontFamily: localFontStyle.fontFamily,
    fontSize: localFontStyle.fontSize,
    fontBold: localFontStyle.fontBold,
    fontItalic: localFontStyle.fontItalic,
    fontUnderline: localFontStyle.fontUnderline,
    selectSlide,
    updateFontStyle,
  };
}
