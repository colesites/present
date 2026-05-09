"use client";

import { useEffect, useRef, useState } from "react";
import type {
  OutputTextPosition,
  ScriptureStyle,
} from "../../../shared/types/output-window";
import type { CanvasSizePreset, SlideElement } from "../../../shared/types";
import type { ScreenComposerLayout } from "../../../shared/types/screen-composer";

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
  hideBackground: boolean;
  textPosition: OutputTextPosition;

  videoSettings: VideoSettings;
  mediaFilterCSS: string;

  isVideoPlaying: boolean;
  videoCurrentTime: number;
  isFrozen?: boolean;
  scriptureStyle: ScriptureStyle;
  libraryStyle: {
    fontFamily: string;
    fontSize: number;
    fontBold: boolean;
    fontItalic: boolean;
    fontUnderline: boolean;
  };
  timerLayout: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
  screenComposerEnabled: boolean;
  screenComposerLayout: ScreenComposerLayout;
};

export function useOutputBroadcast({
  activeMediaItem,
  showText,
  showMedia,
  hideBackground,
  textPosition,
  videoSettings,
  mediaFilterCSS,
  isVideoPlaying,
  videoCurrentTime,
  isFrozen,
  scriptureStyle,
  libraryStyle,
  timerLayout,
  screenComposerEnabled,
  screenComposerLayout,
  activeSlideId,
  slideText,
  slideFooter,
  slideElements,
  slideCanvasSize,
  slideBackgroundColor,
}: Params & {
  activeSlideId?: string | null;
  slideText?: string | null;
  slideFooter?: string | null;
  slideElements?: SlideElement[] | null;
  slideCanvasSize?: CanvasSizePreset | null;
  slideBackgroundColor?: string | null;
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
      hideBackground,
      textPosition,
      videoSettings,
      mediaFilterCSS,
      isVideoPlaying,
      videoCurrentTime,
      shouldSyncTime,
      scriptureStyle,
      libraryStyle,
      timerLayout,
      screenComposerEnabled,
      screenComposerLayout,
    });

    // Send active slide text
    window.electronAPI.sendToOutput({
      type: "active-slide",
      slideId: activeSlideId,
      slideText: slideText,
      slideFooter: slideFooter,
      slideElements,
      slideCanvasSize,
      slideBackgroundColor,
    });
  }, [
    activeMediaItem,
    activeMediaItem?.id,
    activeMediaItem?.type,
    showText,
    showMedia,
    hideBackground,
    textPosition,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying,
    videoCurrentTime,
    isFrozen,
    scriptureStyle,
    scriptureStyle.fontSize,
    scriptureStyle.footerFontSize,
    scriptureStyle.fontFamily,
    scriptureStyle.fontWeight,
    scriptureStyle.textAlign,
    scriptureStyle.verticalAlign,
    scriptureStyle.footerAlign,
    scriptureStyle.footerPosition,
    libraryStyle,
    libraryStyle.fontFamily,
    libraryStyle.fontSize,
    timerLayout,
    timerLayout.xPercent,
    timerLayout.yPercent,
    timerLayout.clockFontPx,
    timerLayout.nameFontPx,
    timerLayout.clockColor,
    timerLayout.nameColor,
    timerLayout.nameBannerEnabled,
    timerLayout.nameBannerColor,
    timerLayout.titlePosition,
    screenComposerEnabled,
    screenComposerLayout,
    activeSlideId,
    slideText,
    slideFooter,
    slideElements,
    slideCanvasSize,
    slideBackgroundColor,
    syncTrigger,
  ]);
}
