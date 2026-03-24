"use client";

import { useEffect, useRef, useState } from "react";

type MediaItem =
  | {
    id: string;
    name: string;
    type: "image" | "video";
    url: string;
  }
  | null
  | undefined;

type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

type Params = {
  activeMediaItem: MediaItem;
  showText: boolean;
  showMedia: boolean;

  videoSettings: VideoSettings;
  mediaFilterCSS: string;

  isVideoPlaying: boolean;
  videoCurrentTime: number;
  isFrozen?: boolean;
  scriptureStyle: {
    fontSize: number;
    fontFamily: string;
    textAlign: "left" | "center" | "right";
  };
  songStyle: {
    fontFamily: string;
    fontSize: number;
    fontBold: boolean;
    fontItalic: boolean;
    fontUnderline: boolean;
  };
};

export function useOutputBroadcast({
  activeMediaItem,
  showText,
  showMedia,
  videoSettings,
  mediaFilterCSS,
  isVideoPlaying,
  videoCurrentTime,
  isFrozen,
  scriptureStyle,
  songStyle,
  activeSlideId,
  slideText,
  slideFooter,
}: Params & {
  activeSlideId?: string | null;
  slideText?: string | null;
  slideFooter?: string | null;
}) {
  /* Track previous video time to only sync when it actually changes */
  const prevVideoTimeRef = useRef<number | undefined>(undefined);
  const wasFrozenRef = useRef(false);

  // Force re-send when a new output window connects
  const [syncTrigger, setSyncTrigger] = useState(0);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onOutputReady(() => {
      setSyncTrigger((t: number) => t + 1);
    });
  }, []);

  // Send full state updates via IPC
  useEffect(() => {
    if (!window.electronAPI) return;

    const previouslyFrozen = wasFrozenRef.current;
    wasFrozenRef.current = !!isFrozen;

    if (isFrozen) return;
    if (previouslyFrozen && !isFrozen) return;

    let mediaId: string | null = null;
    let mediaType: "image" | "video" | null = null;
    let mediaUrl: string | null = null;

    if (activeMediaItem) {
      mediaId = activeMediaItem.id;
      mediaType = activeMediaItem.type;
      mediaUrl = activeMediaItem.url;
    }

    // Check if we should sync time (only if it changed)
    const shouldSyncTime = prevVideoTimeRef.current !== videoCurrentTime;
    prevVideoTimeRef.current = videoCurrentTime;

    // Send media update
    window.electronAPI.sendToOutput({
      type: "media-update",
      mediaUrl,
      mediaId,
      mediaType,
      showText,
      showMedia,
      videoSettings,
      mediaFilterCSS,
      isVideoPlaying,
      videoCurrentTime,
      shouldSyncTime,
      scriptureStyle,
      songStyle,
    });

    // Send active slide text
    window.electronAPI.sendToOutput({
      type: "active-slide",
      slideId: activeSlideId,
      slideText: slideText,
      slideFooter: slideFooter,
    });
  }, [
    activeMediaItem,
    activeMediaItem?.id,
    activeMediaItem?.type,
    showText,
    showMedia,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying,
    videoCurrentTime,
    isFrozen,
    scriptureStyle,
    scriptureStyle.fontSize,
    scriptureStyle.fontFamily,
    scriptureStyle.textAlign,
    songStyle,
    songStyle.fontFamily,
    songStyle.fontSize,
    activeSlideId,
    slideText,
    slideFooter,
    syncTrigger,
  ]);
}
