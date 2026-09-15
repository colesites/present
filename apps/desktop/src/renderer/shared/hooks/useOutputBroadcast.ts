"use client";

import { useEffect, useRef, useState } from "react";
import type {
  OutputTextPosition,
  PropsOverlayItem,
  ScriptureStyle,
} from "../../../shared/types/output-window";
import type {
  CanvasSizePreset,
  MessageOverlay,
  SlideElement,
} from "../../../shared/types";
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

type ActiveSlidePayload = {
  type: "active-slide";
  slideId: string | null;
  slideText: string | null | undefined;
  slideFooter: string | null | undefined;
  slideElements: SlideElement[] | null | undefined;
  slideCanvasSize: CanvasSizePreset | null | undefined;
  slideBackgroundColor: string | null | undefined;
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
  videoTimeSampledAtMs?: number | null;
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
    nameBannerHeightPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
  screenComposerEnabled: boolean;
  screenComposerLayout: ScreenComposerLayout;
  // Active banner overlay being broadcast to the audience output, or null
  // when nothing is currently shown. Drives the Messages tab's "Show" button.
  messageOverlay: MessageOverlay | null;
  // Visible props (image / text overlays) above the slide. Empty array =
  // nothing showing.
  propsOverlay: PropsOverlayItem[];
};

function getPayloadSignature(payload: unknown): string {
  try {
    return JSON.stringify(payload) ?? "";
  } catch {
    return "";
  }
}

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
  videoTimeSampledAtMs = null,
  isFrozen,
  scriptureStyle,
  libraryStyle,
  timerLayout,
  screenComposerEnabled,
  screenComposerLayout,
  messageOverlay,
  propsOverlay,
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
  const lastSlidePayloadRef = useRef<ActiveSlidePayload | null>(null);

  // Force re-send when a new output window connects
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [worshipStageSyncTrigger, setWorshipStageSyncTrigger] = useState(0);
  const lastOutputSyncTriggerRef = useRef(0);
  const lastWorshipStageSyncTriggerRef = useRef(0);
  const lastMediaOutputSignatureRef = useRef<string | null>(null);
  const lastMediaWorshipSignatureRef = useRef<string | null>(null);
  const lastSlideOutputSignatureRef = useRef<string | null>(null);
  const lastSlideWorshipSignatureRef = useRef<string | null>(null);
  const lastMessageOutputSignatureRef = useRef<string | null>(null);
  const lastPropsOutputSignatureRef = useRef<string | null>(null);
  const activeMediaId = activeMediaItem?.id ?? null;
  const activeMediaType = activeMediaItem?.type ?? null;
  const activeMediaUrl = activeMediaItem?.url ?? null;
  const {
    xPercent: textXPercent,
    yPercent: textYPercent,
    widthPercent: textWidthPercent,
    heightPercent: textHeightPercent,
    textAlign,
    verticalAlign,
  } = textPosition;
  const { loop: videoLoop, muted: videoMuted } = videoSettings;
  const {
    fontSize: scriptureFontSize,
    footerFontSize: scriptureFooterFontSize,
    fontFamily: scriptureFontFamily,
    fontWeight: scriptureFontWeight,
    textAlign: scriptureTextAlign,
    verticalAlign: scriptureVerticalAlign,
    footerAlign: scriptureFooterAlign,
    footerPosition: scriptureFooterPosition,
  } = scriptureStyle;
  const {
    fontFamily: libraryFontFamily,
    fontSize: libraryFontSize,
    fontBold,
    fontItalic,
    fontUnderline,
  } = libraryStyle;
  const {
    xPercent: timerXPercent,
    yPercent: timerYPercent,
    clockFontPx,
    nameFontPx,
    nameBannerHeightPx,
    clockColor,
    nameColor,
    nameBannerEnabled,
    nameBannerColor,
    titlePosition,
  } = timerLayout;

  useEffect(() => {
    if (!window.electronAPI) return;
    const outputReadyCleanup = window.electronAPI.onOutputReady(() => {
      setSyncTrigger((t: number) => t + 1);
    });
    const worshipStageReadyCleanup = window.electronAPI.onWorshipStageReady?.(() => {
      setWorshipStageSyncTrigger((t: number) => t + 1);
    });

    return () => {
      outputReadyCleanup();
      worshipStageReadyCleanup?.();
    };
  }, []);

  // Send full state updates via IPC
  useEffect(() => {
    if (!window.electronAPI) return;

    const previouslyFrozen = wasFrozenRef.current;
    wasFrozenRef.current = !!isFrozen;

    if (isFrozen) return;
    if (previouslyFrozen && !isFrozen) return;

    const forceOutputSync = syncTrigger !== lastOutputSyncTriggerRef.current;
    const forceWorshipStageSync =
      worshipStageSyncTrigger !== lastWorshipStageSyncTriggerRef.current;
    lastOutputSyncTriggerRef.current = syncTrigger;
    lastWorshipStageSyncTriggerRef.current = worshipStageSyncTrigger;

    // Check if we should sync time (only if it changed)
    const shouldSyncTime = prevVideoTimeRef.current !== videoCurrentTime;
    prevVideoTimeRef.current = videoCurrentTime;

    // Send media update
    const mediaPayload = {
      type: "media-update",
      mediaUrl: activeMediaUrl,
      mediaId: activeMediaId,
      mediaType: activeMediaType,
      showText,
      showMedia,
      hideBackground,
      textPosition: {
        xPercent: textXPercent,
        yPercent: textYPercent,
        widthPercent: textWidthPercent,
        heightPercent: textHeightPercent,
        textAlign,
        verticalAlign,
      },
      videoSettings: {
        loop: videoLoop,
        muted: videoMuted,
      },
      mediaFilterCSS,
      isVideoPlaying,
      videoCurrentTime,
      videoTimeSampledAtMs,
      shouldSyncTime,
      scriptureStyle: {
        fontSize: scriptureFontSize,
        footerFontSize: scriptureFooterFontSize,
        fontFamily: scriptureFontFamily,
        fontWeight: scriptureFontWeight,
        textAlign: scriptureTextAlign,
        verticalAlign: scriptureVerticalAlign,
        footerAlign: scriptureFooterAlign,
        footerPosition: scriptureFooterPosition,
      },
      libraryStyle: {
        fontFamily: libraryFontFamily,
        fontSize: libraryFontSize,
        fontBold,
        fontItalic,
        fontUnderline,
      },
      timerLayout: {
        xPercent: timerXPercent,
        yPercent: timerYPercent,
        clockFontPx,
        nameFontPx,
        nameBannerHeightPx,
        clockColor,
        nameColor,
        nameBannerEnabled,
        nameBannerColor,
        titlePosition,
      },
      screenComposerEnabled,
      screenComposerLayout,
    };
    const mediaSignature = getPayloadSignature({
      ...mediaPayload,
      shouldSyncTime: false,
    });

    // Send the slide payload before media/showText changes. When a user turns
    // text back on by selecting a slide, the output window must already know
    // the new slide or it can briefly reveal the previous one.
    const hasIncomingSlideContent =
      Boolean(slideText?.trim()) ||
      (Array.isArray(slideElements) && slideElements.length > 0) ||
      Boolean(slideBackgroundColor);
    const incomingSlidePayload: ActiveSlidePayload = {
      type: "active-slide" as const,
      slideId: activeSlideId,
      slideText: slideText,
      slideFooter: slideFooter,
      slideElements,
      slideCanvasSize,
      slideBackgroundColor,
    };
    const previousSlidePayload = lastSlidePayloadRef.current;
    const shouldKeepPreviousSlide =
      !hasIncomingSlideContent &&
      previousSlidePayload != null &&
      previousSlidePayload.slideId === activeSlideId &&
      (showText || Boolean(activeSlideId));
    const activeSlidePayload = shouldKeepPreviousSlide
      ? previousSlidePayload
      : incomingSlidePayload;
    if (activeSlidePayload) {
      lastSlidePayloadRef.current = activeSlidePayload;
      const activeSlideSignature = getPayloadSignature(activeSlidePayload);
      if (
        forceOutputSync ||
        activeSlideSignature !== lastSlideOutputSignatureRef.current
      ) {
        window.electronAPI.sendToOutput(activeSlidePayload);
        lastSlideOutputSignatureRef.current = activeSlideSignature;
      }
      if (
        window.electronAPI.sendToWorshipStage &&
        (forceWorshipStageSync ||
          activeSlideSignature !== lastSlideWorshipSignatureRef.current)
      ) {
        window.electronAPI.sendToWorshipStage(activeSlidePayload);
        lastSlideWorshipSignatureRef.current = activeSlideSignature;
      }
    }

    if (
      forceOutputSync ||
      mediaSignature !== lastMediaOutputSignatureRef.current
    ) {
      window.electronAPI.sendToOutput(mediaPayload);
      lastMediaOutputSignatureRef.current = mediaSignature;
    }
    if (
      window.electronAPI.sendToWorshipStage &&
      (forceWorshipStageSync ||
        mediaSignature !== lastMediaWorshipSignatureRef.current)
    ) {
      window.electronAPI.sendToWorshipStage(mediaPayload);
      lastMediaWorshipSignatureRef.current = mediaSignature;
    }

    // Broadcast the current banner-message overlay (or null to clear it).
    const messageOverlayPayload = {
      type: "message-overlay",
      overlay: messageOverlay,
    };
    const messageOverlaySignature = getPayloadSignature(messageOverlayPayload);
    if (
      forceOutputSync ||
      messageOverlaySignature !== lastMessageOutputSignatureRef.current
    ) {
      window.electronAPI.sendToOutput(messageOverlayPayload);
      lastMessageOutputSignatureRef.current = messageOverlaySignature;
    }

    // Broadcast the current props (image / text overlays).
    const propsOverlayPayload = {
      type: "props-overlay",
      props: propsOverlay,
    };
    const propsOverlaySignature = getPayloadSignature(propsOverlayPayload);
    if (
      forceOutputSync ||
      propsOverlaySignature !== lastPropsOutputSignatureRef.current
    ) {
      window.electronAPI.sendToOutput(propsOverlayPayload);
      lastPropsOutputSignatureRef.current = propsOverlaySignature;
    }
  }, [
    activeMediaId,
    activeMediaType,
    activeMediaUrl,
    showText,
    showMedia,
    hideBackground,
    textXPercent,
    textYPercent,
    textWidthPercent,
    textHeightPercent,
    textAlign,
    verticalAlign,
    videoLoop,
    videoMuted,
    mediaFilterCSS,
    isVideoPlaying,
    videoCurrentTime,
    videoTimeSampledAtMs,
    isFrozen,
    scriptureFontSize,
    scriptureFooterFontSize,
    scriptureFontFamily,
    scriptureFontWeight,
    scriptureTextAlign,
    scriptureVerticalAlign,
    scriptureFooterAlign,
    scriptureFooterPosition,
    libraryFontFamily,
    libraryFontSize,
    fontBold,
    fontItalic,
    fontUnderline,
    timerXPercent,
    timerYPercent,
    clockFontPx,
    nameFontPx,
    nameBannerHeightPx,
    clockColor,
    nameColor,
    nameBannerEnabled,
    nameBannerColor,
    titlePosition,
    screenComposerEnabled,
    screenComposerLayout,
    messageOverlay,
    propsOverlay,
    activeSlideId,
    slideText,
    slideFooter,
    slideElements,
    slideCanvasSize,
    slideBackgroundColor,
    syncTrigger,
    worshipStageSyncTrigger,
  ]);
}
